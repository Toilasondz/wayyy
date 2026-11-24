//
//  VideoStarOTA.m
//  VideoStarOTA — Hybrid OTA Loader & Bridge Dylib (arm64, -fobjc-arc)
//
//  Chạy được trên cả máy CHƯA Jailbreak (IPA sideload) lẫn máy ĐÃ Jailbreak.
//  Chỉ cần sửa dòng VST_SERVER_BASE_URL bên dưới thành domain Vercel của bạn rồi biên dịch 1 lần.
//

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import <JavaScriptCore/JavaScriptCore.h>
#import <WebKit/WebKit.h>
#import <QuartzCore/QuartzCore.h>
#import <CommonCrypto/CommonDigest.h>
#import <objc/runtime.h>
#import <objc/message.h>

// ============================================================================
// CẤU HÌNH DUY NHẤT CẦN ĐỔI TRƯỚC KHI BIÊN DỊCH
// ============================================================================
#define VST_SERVER_BASE_URL @"https://YOUR-PROJECT.vercel.app"
#define VST_DYLIB_VERSION   @"1.0.0"

// ============================================================================
// TIỆN ÍCH CHUNG (SHA-256, KeyWindow iOS 13+, Thư mục Cache)
// ============================================================================
static NSString *VSTSHA256Hex(NSData *data) {
    if (!data) return @"";
    unsigned char digest[CC_SHA256_DIGEST_LENGTH];
    CC_SHA256(data.bytes, (CC_LONG)data.length, digest);
    NSMutableString *hex = [NSMutableString stringWithCapacity:CC_SHA256_DIGEST_LENGTH * 2];
    for (int i = 0; i < CC_SHA256_DIGEST_LENGTH; i++) {
        [hex appendFormat:@"%02x", digest[i]];
    }
    return hex;
}

static UIWindow *VSTKeyWindow(void) {
    if (@available(iOS 13.0, *)) {
        for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
            if (scene.activationState == UISceneActivationStateForegroundActive &&
                [scene isKindOfClass:[UIWindowScene class]]) {
                UIWindowScene *ws = (UIWindowScene *)scene;
                for (UIWindow *w in ws.windows) {
                    if (w.isKeyWindow) return w;
                }
                if (ws.windows.firstObject) return ws.windows.firstObject;
            }
        }
    }
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    return UIApplication.sharedApplication.keyWindow ?: UIApplication.sharedApplication.windows.firstObject;
#pragma clang diagnostic pop
}

static UIViewController *VSTTopViewController(void) {
    UIViewController *vc = VSTKeyWindow().rootViewController;
    while (vc.presentedViewController) {
        vc = vc.presentedViewController;
    }
    return vc;
}

static NSString *VSTCacheDir(void) {
    NSArray<NSString *> *paths = NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory, NSUserDomainMask, YES);
    NSString *dir = [paths.firstObject stringByAppendingPathComponent:@"VideoStarOTA"];
    [[NSFileManager defaultManager] createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:nil];
    return dir;
}

static NSString *VSTAppVersion(void) {
    return [[NSBundle mainBundle] objectForInfoDictionaryKey:@"CFBundleShortVersionString"] ?: @"unknown";
}

// ============================================================================
// HOOK TÍCH HỢP: BẮT NỘI DUNG CustomPopup -doTheShow (_attributedMessage)
// ============================================================================
static BOOL g_popupCaptureEnabled = NO;
static IMP g_origDoTheShowIMP = NULL;
static void (^g_popupCaptureCallback)(NSString *title, NSString *text) = nil;

static void VSTHooked_CustomPopup_doTheShow(id self, SEL _cmd) {
    if (g_popupCaptureEnabled && g_popupCaptureCallback) {
        @try {
            NSString *title = @"";
            NSString *text = @"";
            Ivar titleIvar = class_getInstanceVariable(object_getClass(self), "_title");
            if (titleIvar) {
                id v = object_getIvar(self, titleIvar);
                if ([v isKindOfClass:[NSString class]]) title = v;
            }
            Ivar attrIvar = class_getInstanceVariable(object_getClass(self), "_attributedMessage");
            if (attrIvar) {
                id v = object_getIvar(self, attrIvar);
                if ([v isKindOfClass:[NSAttributedString class]]) {
                    text = [(NSAttributedString *)v string] ?: @"";
                }
            }
            if (text.length == 0) {
                Ivar msgIvar = class_getInstanceVariable(object_getClass(self), "_message");
                if (msgIvar) {
                    id v = object_getIvar(self, msgIvar);
                    if ([v isKindOfClass:[NSString class]]) text = v;
                }
            }
            if (text.length > 0 || title.length > 0) {
                g_popupCaptureCallback(title, text);
            }
        } @catch (__unused NSException *ex) {}
    }

    if (g_origDoTheShowIMP) {
        ((void (*)(id, SEL))g_origDoTheShowIMP)(self, _cmd);
    }
}

static void VSTInstallPopupHookOnce(void) {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        Class cls = NSClassFromString(@"CustomPopup");
        if (!cls) return;
        SEL sel = NSSelectorFromString(@"doTheShow");
        Method m = class_getInstanceMethod(cls, sel);
        if (!m) return;
        g_origDoTheShowIMP = method_setImplementation(m, (IMP)VSTHooked_CustomPopup_doTheShow);
    });
}

// ============================================================================
// BỘ QUẢN LÝ OTA + JAVASCRIPTCORE ENGINE + WKWEBVIEW PANEL
// ============================================================================
@interface VSTOTAManager : NSObject <WKScriptMessageHandler>
@property (nonatomic, strong) JSContext *jsContext;
@property (nonatomic, strong) NSDictionary *manifest;
@property (nonatomic, strong) NSDictionary *config;
@property (nonatomic, strong) NSMutableArray<NSString *> *logs;
@property (nonatomic, strong) UIButton *floatingButton;
@property (nonatomic, strong) UIView *panelOverlay;
@property (nonatomic, strong) WKWebView *panelWebView;
@property (nonatomic, assign) BOOL isSyncing;
+ (instancetype)shared;
- (void)start;
- (void)checkForUpdates:(BOOL)userTriggered;
- (void)showToast:(NSString *)message;
- (void)openPanel;
- (void)closePanel;
@end

@implementation VSTOTAManager

+ (instancetype)shared {
    static VSTOTAManager *inst = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        inst = [[VSTOTAManager alloc] init];
    });
    return inst;
}

- (instancetype)init {
    self = [super init];
    if (self) {
        _logs = [NSMutableArray array];
    }
    return self;
}

- (void)appendLog:(NSString *)msg {
    if (!msg) return;
    NSLog(@"[VideoStarOTA] %@", msg);
    @synchronized (self.logs) {
        [self.logs addObject:msg];
        if (self.logs.count > 200) {
            [self.logs removeObjectAtIndex:0];
        }
    }
}

- (void)start {
    __weak typeof(self) weakSelf = self;
    g_popupCaptureCallback = ^(NSString *title, NSString *text) {
        __strong typeof(weakSelf) strongSelf = weakSelf;
        if (!strongSelf || !strongSelf.jsContext) return;
        dispatch_async(dispatch_get_main_queue(), ^{
            JSValue *cb = strongSelf.jsContext[@"onPopupCaptured"];
            if (cb && !cb.isUndefined && !cb.isNull) {
                [cb callWithArguments:@[title ?: @"", text ?: @""]];
            }
        });
    };

    // 1. Nạp bản cache cục bộ ngay lập tức (hoạt động cả khi mất mạng)
    [self loadCachedBundleAndRun];

    // 2. Tạo nút nổi sau khi UI sẵn sàng
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1.2 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        [self installFloatingButton];
    });

    // 3. Kiểm tra bản cập nhật OTA mới nhất từ Vercel ở nền
    [self checkForUpdates:NO];
}

#pragma mark - Local Cache & Integrity

- (NSString *)cachePathFor:(NSString *)name {
    return [VSTCacheDir() stringByAppendingPathComponent:name];
}

- (void)loadCachedBundleAndRun {
    NSData *manifestData = [NSData dataWithContentsOfFile:[self cachePathFor:@"manifest.json"]];
    if (!manifestData) return;

    NSDictionary *manifest = [NSJSONSerialization JSONObjectWithData:manifestData options:0 error:nil];
    if (![manifest isKindOfClass:[NSDictionary class]]) return;

    self.manifest = manifest;
    if ([manifest[@"killSwitch"] boolValue]) {
        [self appendLog:@"Kill Switch đang bật — không nạp payload.js"];
        return;
    }

    NSData *configData = [NSData dataWithContentsOfFile:[self cachePathFor:@"config.json"]];
    NSData *payloadData = [NSData dataWithContentsOfFile:[self cachePathFor:@"payload.js"]];

    NSDictionary *files = manifest[@"files"];
    NSString *expectedCfgSha = files[@"config"][@"sha256"];
    NSString *expectedPaySha = files[@"payload"][@"sha256"];

    if (configData && (!expectedCfgSha || [VSTSHA256Hex(configData) isEqualToString:expectedCfgSha])) {
        NSDictionary *cfg = [NSJSONSerialization JSONObjectWithData:configData options:0 error:nil];
        if ([cfg isKindOfClass:[NSDictionary class]]) {
            self.config = cfg;
        }
    }

    if (payloadData && (!expectedPaySha || [VSTSHA256Hex(payloadData) isEqualToString:expectedPaySha])) {
        NSString *code = [[NSString alloc] initWithData:payloadData encoding:NSUTF8StringEncoding];
        if (code.length > 0) {
            [self evaluatePayloadCode:code];
        }
    }
}

#pragma mark - OTA Sync from Vercel

- (void)checkForUpdates:(BOOL)userTriggered {
    if (self.isSyncing) return;
    self.isSyncing = YES;

    NSString *urlStr = [NSString stringWithFormat:@"%@/api/manifest?appVersion=%@&dylibVersion=%@&t=%.0f",
                        VST_SERVER_BASE_URL,
                        [VSTAppVersion() stringByAddingPercentEncodingWithAllowedCharacters:[NSCharacterSet URLQueryAllowedCharacterSet]],
                        VST_DYLIB_VERSION,
                        [[NSDate date] timeIntervalSince1970]];
    NSURL *url = [NSURL URLWithString:urlStr];
    if (!url) {
        self.isSyncing = NO;
        return;
    }

    NSURLRequest *req = [NSURLRequest requestWithURL:url
                                         cachePolicy:NSURLRequestReloadIgnoringLocalCacheData
                                     timeoutInterval:12.0];

    __weak typeof(self) weakSelf = self;
    [[[NSURLSession sharedSession] dataTaskWithRequest:req completionHandler:^(NSData *data, NSURLResponse *resp, NSError *err) {
        __strong typeof(weakSelf) strongSelf = weakSelf;
        if (!strongSelf) return;

        if (err || !data) {
            strongSelf.isSyncing = NO;
            [strongSelf appendLog:[NSString stringWithFormat:@"Lỗi kiểm tra OTA: %@", err.localizedDescription ?: @"No data"]];
            if (userTriggered) {
                [strongSelf showToast:@"Không kết nối được server Vercel"];
            }
            return;
        }

        NSDictionary *remote = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
        if (![remote isKindOfClass:[NSDictionary class]] || ![remote[@"ok"] boolValue]) {
            strongSelf.isSyncing = NO;
            if (userTriggered) [strongSelf showToast:@"Manifest server không hợp lệ"];
            return;
        }

        NSString *announcement = remote[@"announcement"];
        if ([announcement isKindOfClass:[NSString class]] && announcement.length > 0) {
            NSString *lastAnn = [[NSUserDefaults standardUserDefaults] stringForKey:@"VST_OTA_LAST_ANN"];
            if (![lastAnn isEqualToString:announcement]) {
                [[NSUserDefaults standardUserDefaults] setObject:announcement forKey:@"VST_OTA_LAST_ANN"];
                [strongSelf showAlertWithTitle:@"Thông báo VideoStarOTA" message:announcement];
            }
        }

        if ([remote[@"killSwitch"] boolValue]) {
            [data writeToFile:[strongSelf cachePathFor:@"manifest.json"] atomically:YES];
            strongSelf.manifest = remote;
            strongSelf.jsContext = nil;
            strongSelf.isSyncing = NO;
            if (userTriggered) [strongSelf showToast:@"Server đang tạm ngưng tính năng từ xa"];
            return;
        }

        NSString *localVer = strongSelf.manifest[@"version"];
        NSString *remoteVer = remote[@"version"];
        NSString *localSha = strongSelf.manifest[@"files"][@"payload"][@"sha256"];
        NSString *remoteSha = remote[@"files"][@"payload"][@"sha256"];

        if ([localVer isEqualToString:remoteVer] && [localSha isEqualToString:remoteSha]) {
            strongSelf.isSyncing = NO;
            if (userTriggered) {
                [strongSelf showToast:[NSString stringWithFormat:@"Đang ở bản mới nhất (v%@)", remoteVer]];
            }
            return;
        }

        [strongSelf downloadAndApplyRemoteManifest:remote rawManifestData:data userTriggered:userTriggered];
    }] resume];
}

- (void)downloadAndApplyRemoteManifest:(NSDictionary *)remote rawManifestData:(NSData *)rawManifest userTriggered:(BOOL)userTriggered {
    NSDictionary *files = remote[@"files"];
    NSString *payloadUrl = files[@"payload"][@"url"];
    NSString *configUrl  = files[@"config"][@"url"];
    NSString *panelUrl   = files[@"panel"][@"url"];

    NSString *payloadSha = files[@"payload"][@"sha256"];
    NSString *configSha  = files[@"config"][@"sha256"];
    NSString *panelSha   = files[@"panel"][@"sha256"];

    dispatch_group_t group = dispatch_group_create();
    __block NSData *dlPayload = nil;
    __block NSData *dlConfig  = nil;
    __block NSData *dlPanel   = nil;

    void (^fetchOne)(NSString *, void (^)(NSData *)) = ^(NSString *uStr, void (^done)(NSData *)) {
        if (![uStr isKindOfClass:[NSString class]] || uStr.length == 0) return;
        dispatch_group_enter(group);
        NSURLRequest *r = [NSURLRequest requestWithURL:[NSURL URLWithString:uStr]
                                           cachePolicy:NSURLRequestReloadIgnoringLocalCacheData
                                       timeoutInterval:15.0];
        [[[NSURLSession sharedSession] dataTaskWithRequest:r completionHandler:^(NSData *d, NSURLResponse *resp, NSError *e) {
            if (!e && d) done(d);
            dispatch_group_leave(group);
        }] resume];
    };

    fetchOne(payloadUrl, ^(NSData *d) { dlPayload = d; });
    fetchOne(configUrl,  ^(NSData *d) { dlConfig  = d; });
    fetchOne(panelUrl,   ^(NSData *d) { dlPanel   = d; });

    __weak typeof(self) weakSelf = self;
    dispatch_group_notify(group, dispatch_get_main_queue(), ^{
        __strong typeof(weakSelf) strongSelf = weakSelf;
        if (!strongSelf) return;
        strongSelf.isSyncing = NO;

        if (!dlPayload || !dlConfig || !dlPanel) {
            [strongSelf appendLog:@"Tải thiếu tệp OTA — giữ nguyên bản cache cũ."];
            if (userTriggered) [strongSelf showToast:@"Tải bản cập nhật thất bại"];
            return;
        }

        // Kiểm tra toàn vẹn SHA-256 trước khi ghi đè
        if ((payloadSha && ![VSTSHA256Hex(dlPayload) isEqualToString:payloadSha]) ||
            (configSha  && ![VSTSHA256Hex(dlConfig)  isEqualToString:configSha])  ||
            (panelSha   && ![VSTSHA256Hex(dlPanel)   isEqualToString:panelSha])) {
            [strongSelf appendLog:@"Sai mã kiểm tra SHA-256 — từ chối nạp bản cập nhật!"];
            if (userTriggered) [strongSelf showToast:@"Lỗi SHA-256, đã hủy cập nhật"];
            return;
        }

        [dlPayload writeToFile:[strongSelf cachePathFor:@"payload.js"] atomically:YES];
        [dlConfig  writeToFile:[strongSelf cachePathFor:@"config.json"] atomically:YES];
        [dlPanel   writeToFile:[strongSelf cachePathFor:@"panel.html"] atomically:YES];
        [rawManifest writeToFile:[strongSelf cachePathFor:@"manifest.json"] atomically:YES];

        strongSelf.manifest = remote;
        NSDictionary *cfg = [NSJSONSerialization JSONObjectWithData:dlConfig options:0 error:nil];
        if ([cfg isKindOfClass:[NSDictionary class]]) {
            strongSelf.config = cfg;
        }

        NSString *code = [[NSString alloc] initWithData:dlPayload encoding:NSUTF8StringEncoding];
        [strongSelf evaluatePayloadCode:code];

        // Nếu Panel đang mở thì nạp lại giao diện mới luôn
        if (strongSelf.panelWebView) {
            NSString *html = [[NSString alloc] initWithData:dlPanel encoding:NSUTF8StringEncoding];
            [strongSelf.panelWebView loadHTMLString:html baseURL:[NSURL URLWithString:VST_SERVER_BASE_URL]];
        }

        [strongSelf showToast:[NSString stringWithFormat:@"Đã cập nhật OTA v%@", remote[@"version"] ?: @"?"]];
    });
}

#pragma mark - JavaScriptCore Engine & Native Bridge

- (void)evaluatePayloadCode:(NSString *)code {
    if (code.length == 0) return;

    dispatch_async(dispatch_get_main_queue(), ^{
        JSContext *ctx = [[JSContext alloc] init];
        __weak typeof(self) weakSelf = self;

        ctx.exceptionHandler = ^(JSContext *context, JSValue *exception) {
            [weakSelf appendLog:[NSString stringWithFormat:@"[JS Error] %@", exception.toString]];
        };

        // Gắn cầu nối VST vào JavaScriptCore
        NSMutableDictionary *vst = [NSMutableDictionary dictionary];

        vst[@"getAppInfo"] = ^NSDictionary *() {
            return @{
                @"appVersion": VSTAppVersion(),
                @"bundleId": [[NSBundle mainBundle] bundleIdentifier] ?: @"",
                @"otaVersion": weakSelf.manifest[@"version"] ?: @"0.0.0",
                @"dylibVersion": VST_DYLIB_VERSION,
                @"serverUrl": VST_SERVER_BASE_URL,
                @"iosVersion": UIDevice.currentDevice.systemVersion ?: @""
            };
        };

        vst[@"getConfig"] = ^NSDictionary *() {
            return weakSelf.config ?: @{};
        };

        vst[@"log"] = ^(NSString *msg) {
            [weakSelf appendLog:msg];
        };

        vst[@"toast"] = ^(NSString *msg) {
            [weakSelf showToast:msg];
        };

        vst[@"alert"] = ^(NSString *title, NSString *msg) {
            [weakSelf showAlertWithTitle:title message:msg];
        };

        vst[@"storageGet"] = ^NSString *(NSString *key) {
            if (!key) return @"";
            return [[NSUserDefaults standardUserDefaults] stringForKey:[@"VST_OTA_" stringByAppendingString:key]] ?: @"";
        };

        vst[@"storageSet"] = ^(NSString *key, NSString *val) {
            if (!key) return;
            [[NSUserDefaults standardUserDefaults] setObject:(val ?: @"") forKey:[@"VST_OTA_" stringByAppendingString:key]];
        };

        vst[@"copyToClipboard"] = ^(NSString *text) {
            dispatch_async(dispatch_get_main_queue(), ^{
                UIPasteboard.generalPasteboard.string = text ?: @"";
            });
        };

        vst[@"getClipboard"] = ^NSString *() {
            return UIPasteboard.generalPasteboard.string ?: @"";
        };

        vst[@"checkUpdate"] = ^() {
            [weakSelf checkForUpdates:YES];
        };

        vst[@"openPanel"] = ^() {
            [weakSelf openPanel];
        };

        vst[@"closePanel"] = ^() {
            [weakSelf closePanel];
        };

        vst[@"hasClass"] = ^BOOL(NSString *className) {
            return className.length > 0 && NSClassFromString(className) != nil;
        };

        vst[@"classRespondsTo"] = ^BOOL(NSString *className, NSString *selName) {
            Class cls = NSClassFromString(className);
            if (!cls || selName.length == 0) return NO;
            SEL sel = NSSelectorFromString(selName);
            return [cls instancesRespondToSelector:sel] || [cls respondsToSelector:sel];
        };

        vst[@"hookPopupCapture"] = ^(BOOL enabled) {
            VSTInstallPopupHookOnce();
            g_popupCaptureEnabled = enabled;
        };

        vst[@"httpGet"] = ^(NSString *urlStr, JSValue *callback) {
            NSURL *u = [NSURL URLWithString:urlStr ?: @""];
            if (!u) return;
            [[[NSURLSession sharedSession] dataTaskWithURL:u completionHandler:^(NSData *d, NSURLResponse *r, NSError *e) {
                NSString *body = d ? [[NSString alloc] initWithData:d encoding:NSUTF8StringEncoding] : @"";
                dispatch_async(dispatch_get_main_queue(), ^{
                    if (callback && !callback.isUndefined) {
                        [callback callWithArguments:@[e ? e.localizedDescription : [NSNull null], body ?: @""]];
                    }
                });
            }] resume];
        };

        ctx[@"VST"] = vst;
        self.jsContext = ctx;

        [ctx evaluateScript:code withSourceURL:[NSURL URLWithString:@"videostar-ota://payload.js"]];
    });
}

#pragma mark - Floating Button & Liquid Glass WKWebView Panel

- (void)installFloatingButton {
    UIWindow *win = VSTKeyWindow();
    if (!win || self.floatingButton) return;

    UIButton *btn = [UIButton buttonWithType:UIButtonTypeCustom];
    btn.frame = CGRectMake(win.bounds.size.width - 62, 140, 48, 48);
    btn.layer.cornerRadius = 24;
    btn.layer.masksToBounds = YES;
    btn.backgroundColor = [UIColor colorWithRed:0.08 green:0.12 blue:0.24 alpha:0.86];
    btn.layer.borderWidth = 1.2;
    btn.layer.borderColor = [UIColor colorWithRed:0.22 green:0.74 blue:0.97 alpha:0.75].CGColor;
    [btn setTitle:@"VS" forState:UIControlStateNormal];
    btn.titleLabel.font = [UIFont boldSystemFontOfSize:15];
    [btn setTitleColor:[UIColor whiteColor] forState:UIControlStateNormal];

    [btn addTarget:self action:@selector(openPanel) forControlEvents:UIControlEventTouchUpInside];

    UIPanGestureRecognizer *pan = [[UIPanGestureRecognizer alloc] initWithTarget:self action:@selector(handleFloatPan:)];
    [btn addGestureRecognizer:pan];

    UILongPressGestureRecognizer *lp = [[UILongPressGestureRecognizer alloc] initWithTarget:self action:@selector(handleFloatLongPress:)];
    [btn addGestureRecognizer:lp];

    [win addSubview:btn];
    self.floatingButton = btn;
}

- (void)handleFloatPan:(UIPanGestureRecognizer *)pan {
    UIView *v = pan.view;
    UIView *superview = v.superview;
    if (!v || !superview) return;
    CGPoint t = [pan translationInView:superview];
    v.center = CGPointMake(v.center.x + t.x, v.center.y + t.y);
    [pan setTranslation:CGPointZero inView:superview];
}

- (void)handleFloatLongPress:(UILongPressGestureRecognizer *)lp {
    if (lp.state == UIGestureRecognizerStateBegan) {
        [self checkForUpdates:YES];
    }
}

- (void)openPanel {
    dispatch_async(dispatch_get_main_queue(), ^{
        UIWindow *win = VSTKeyWindow();
        if (!win) return;
        if (self.panelOverlay) {
            self.panelOverlay.hidden = NO;
            [win bringSubviewToFront:self.panelOverlay];
            return;
        }

        UIView *overlay = [[UIView alloc] initWithFrame:win.bounds];
        overlay.backgroundColor = [UIColor colorWithWhite:0 alpha:0.45];
        overlay.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;

        CGFloat w = MIN(win.bounds.size.width - 28, 390);
        CGFloat h = MIN(win.bounds.size.height - 120, 560);
        CGRect cardFrame = CGRectMake((win.bounds.size.width - w) / 2.0,
                                      (win.bounds.size.height - h) / 2.0, w, h);

        WKWebViewConfiguration *wkCfg = [[WKWebViewConfiguration alloc] init];
        [wkCfg.userContentController addScriptMessageHandler:self name:@"vstBridge"];

        WKWebView *wv = [[WKWebView alloc] initWithFrame:cardFrame configuration:wkCfg];
        wv.opaque = NO;
        wv.backgroundColor = [UIColor clearColor];
        wv.scrollView.backgroundColor = [UIColor clearColor];
        wv.layer.cornerRadius = 20;
        wv.layer.masksToBounds = YES;
        wv.layer.borderWidth = 1.0;
        wv.layer.borderColor = [UIColor colorWithWhite:1.0 alpha:0.22].CGColor;

        NSData *cachedHtml = [NSData dataWithContentsOfFile:[self cachePathFor:@"panel.html"]];
        if (cachedHtml) {
            NSString *htmlStr = [[NSString alloc] initWithData:cachedHtml encoding:NSUTF8StringEncoding];
            [wv loadHTMLString:htmlStr baseURL:[NSURL URLWithString:VST_SERVER_BASE_URL]];
        } else {
            NSURL *remoteUrl = [NSURL URLWithString:[NSString stringWithFormat:@"%@/api/bundle?file=panel.html", VST_SERVER_BASE_URL]];
            [wv loadRequest:[NSURLRequest requestWithURL:remoteUrl]];
        }

        [overlay addSubview:wv];
        [win addSubview:overlay];

        self.panelOverlay = overlay;
        self.panelWebView = wv;
    });
}

- (void)closePanel {
    dispatch_async(dispatch_get_main_queue(), ^{
        self.panelOverlay.hidden = YES;
    });
}

- (void)sendToPanel:(NSDictionary *)payload {
    if (!self.panelWebView || !payload) return;
    NSData *jsonData = [NSJSONSerialization dataWithJSONObject:payload options:0 error:nil];
    if (!jsonData) return;
    NSString *jsonStr = [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding];
    NSString *js = [NSString stringWithFormat:@"window.__vstReceive && window.__vstReceive(%@);", jsonStr];
    dispatch_async(dispatch_get_main_queue(), ^{
        [self.panelWebView evaluateJavaScript:js completionHandler:nil];
    });
}

#pragma mark - WKScriptMessageHandler (2-way Bridge)

- (void)userContentController:(WKUserContentController *)userContentController
      didReceiveScriptMessage:(WKScriptMessage *)message {
    if (![message.name isEqualToString:@"vstBridge"]) return;
    NSDictionary *body = [message.body isKindOfClass:[NSDictionary class]] ? message.body : nil;
    if (!body) return;

    NSString *type = body[@"type"];
    NSDictionary *payload = [body[@"payload"] isKindOfClass:[NSDictionary class]] ? body[@"payload"] : @{};

    if ([type isEqualToString:@"close"]) {
        [self closePanel];
        return;
    }

    if ([type isEqualToString:@"ready"]) {
        [self sendToPanel:@{
            @"type": @"init",
            @"data": @{
                @"appVersion": VSTAppVersion(),
                @"otaVersion": self.manifest[@"version"] ?: @"0.0.0",
                @"delayMode": [[NSUserDefaults standardUserDefaults] stringForKey:@"VST_OTA_delay_mode"] ?: @"0"
            }
        }];
        return;
    }

    if ([type isEqualToString:@"action"]) {
        NSString *actionName = payload[@"action"] ?: @"";
        NSDictionary *actionData = [payload[@"payload"] isKindOfClass:[NSDictionary class]] ? payload[@"payload"] : @{};

        if (self.jsContext) {
            JSValue *fn = self.jsContext[@"onPanelAction"];
            if (fn && !fn.isUndefined && !fn.isNull) {
                JSValue *res = [fn callWithArguments:@[actionName, actionData]];
                id obj = [res toObject];
                [self sendToPanel:@{
                    @"type": @"actionResult",
                    @"action": actionName,
                    @"result": obj ?: @{@"ok": @YES}
                }];
                return;
            }
        }
        [self sendToPanel:@{@"type": @"error", @"message": @"Payload JS chưa được nạp."}];
    }
}

#pragma mark - Native UI Helpers

- (void)showToast:(NSString *)message {
    if (message.length == 0) return;
    dispatch_async(dispatch_get_main_queue(), ^{
        UIWindow *win = VSTKeyWindow();
        if (!win) return;

        UILabel *lbl = [[UILabel alloc] init];
        lbl.text = [NSString stringWithFormat:@"  %@  ", message];
        lbl.font = [UIFont systemFontOfSize:13 weight:UIFontWeightSemibold];
        lbl.textColor = [UIColor whiteColor];
        lbl.backgroundColor = [UIColor colorWithRed:0.08 green:0.12 blue:0.24 alpha:0.92];
        lbl.layer.cornerRadius = 16;
        lbl.layer.masksToBounds = YES;
        lbl.layer.borderWidth = 1.0;
        lbl.layer.borderColor = [UIColor colorWithRed:0.22 green:0.74 blue:0.97 alpha:0.6].CGColor;
        lbl.textAlignment = NSTextAlignmentCenter;
        [lbl sizeToFit];

        CGFloat w = MIN(lbl.bounds.size.width + 20, win.bounds.size.width - 40);
        lbl.frame = CGRectMake((win.bounds.size.width - w) / 2.0, 62, w, 34);
        lbl.alpha = 0.0;
        [win addSubview:lbl];

        [UIView animateWithDuration:0.22 animations:^{
            lbl.alpha = 1.0;
        } completion:^(__unused BOOL finished) {
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(2.4 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
                [UIView animateWithDuration:0.25 animations:^{
                    lbl.alpha = 0.0;
                } completion:^(__unused BOOL done) {
                    [lbl removeFromSuperview];
                }];
            });
        }];
    });
}

- (void)showAlertWithTitle:(NSString *)title message:(NSString *)message {
    dispatch_async(dispatch_get_main_queue(), ^{
        UIViewController *top = VSTTopViewController();
        if (!top) return;
        UIAlertController *ac = [UIAlertController alertControllerWithTitle:title ?: @"VideoStarOTA"
                                                                    message:message ?: @""
                                                             preferredStyle:UIAlertControllerStyleAlert];
        [ac addAction:[UIAlertAction actionWithTitle:@"Đóng" style:UIAlertActionStyleDefault handler:nil]];
        [top presentViewController:ac animated:YES completion:nil];
    });
}

@end

// ============================================================================
// ENTRY POINT KHI DYLIB ĐƯỢC NẠP VÀO VIDEO STAR
// ============================================================================
__attribute__((constructor))
static void VSTOTAConstructor(void) {
    [[NSNotificationCenter defaultCenter] addObserverForName:UIApplicationDidFinishLaunchingNotification
                                                      object:nil
                                                       queue:[NSOperationQueue mainQueue]
                                                  usingBlock:^(__unused NSNotification *note) {
        [[VSTOTAManager shared] start];
    }];
}
