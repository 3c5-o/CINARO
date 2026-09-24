package com.cinaro.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.PictureInPictureParams;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.pm.ApplicationInfo;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Rational;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

public class MainActivity extends Activity {
    private static final String APP_HOST = "3c5-o.github.io";

    private WebView webView;
    private FrameLayout rootView;
    private View fullscreenView;
    private WebChromeClient.CustomViewCallback fullscreenCallback;
    private boolean usingOfflineFallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureWindow();

        rootView = new FrameLayout(this);
        rootView.setBackgroundColor(Color.BLACK);
        webView = new WebView(this);
        rootView.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        setContentView(rootView);

        configureWebView();

        SharedPreferences runtimePreferences = getSharedPreferences("cinaro_runtime", MODE_PRIVATE);
        int lastVersionCode = runtimePreferences.getInt("last_version_code", -1);
        boolean appUpdated = lastVersionCode != BuildConfig.VERSION_CODE;

        if (appUpdated) {
            webView.clearCache(true);
            webView.clearHistory();
        }

        if (savedInstanceState == null || appUpdated) {
            webView.loadUrl(BuildConfig.ONLINE_APP_URL);
        } else {
            webView.restoreState(savedInstanceState);
        }

        runtimePreferences.edit().putInt("last_version_code", BuildConfig.VERSION_CODE).apply();
    }

    private void configureWindow() {
        Window window = getWindow();
        if (BuildConfig.BLOCK_SCREEN_CAPTURE) {
            window.addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        }
        window.setStatusBarColor(Color.rgb(8, 9, 13));
        window.setNavigationBarColor(Color.rgb(8, 9, 13));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            window.getDecorView().setSystemUiVisibility(0);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                controller.setSystemBarsAppearance(0,
                        WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS |
                        WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
            }
        }
    }

    @SuppressLint({"SetJavaScriptEnabled", "ObsoleteSdkInt"})
    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadWithOverviewMode(false);
        settings.setUseWideViewPort(true);
        settings.setTextZoom(100);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setSupportZoom(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setUserAgentString(settings.getUserAgentString() + " CINARO/2.3.1 AndroidApp");

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.setSafeBrowsingEnabled(true);
        }

        boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView.setWebContentsDebuggingEnabled(debuggable);
        webView.setBackgroundColor(Color.BLACK);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setHorizontalScrollBarEnabled(false);
        webView.setWebViewClient(new CinaroWebViewClient());
        webView.setWebChromeClient(new CinaroChromeClient());
        webView.setDownloadListener(new CinaroDownloadListener());
        webView.addJavascriptInterface(new NativeBridge(), "CinaroNative");
    }

    private class CinaroWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            String scheme = uri.getScheme();
            if ("file".equalsIgnoreCase(scheme) || "about".equalsIgnoreCase(scheme) || isCinaroWebUrl(uri)) {
                return false;
            }
            openExternal(uri);
            return true;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            super.onReceivedError(view, request, error);
            if (request.isForMainFrame()) {
                fallBackToOffline(view, request.getUrl());
            }
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
            super.onReceivedHttpError(view, request, errorResponse);
            if (request.isForMainFrame() && errorResponse.getStatusCode() >= 400) {
                fallBackToOffline(view, request.getUrl());
            }
        }
    }

    private boolean isCinaroWebUrl(Uri uri) {
        return "https".equalsIgnoreCase(uri.getScheme())
                && APP_HOST.equalsIgnoreCase(uri.getHost())
                && uri.getPath() != null
                && uri.getPath().startsWith(BuildConfig.APP_PATH);
    }

    private void fallBackToOffline(WebView view, Uri failedUri) {
        if (!usingOfflineFallback && isCinaroWebUrl(failedUri)) {
            usingOfflineFallback = true;
            Toast.makeText(this, R.string.offline_fallback, Toast.LENGTH_SHORT).show();
            view.loadUrl(BuildConfig.OFFLINE_APP_URL);
            return;
        }
        Toast.makeText(this, R.string.page_load_error, Toast.LENGTH_SHORT).show();
    }

    private class CinaroChromeClient extends WebChromeClient {
        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (fullscreenView != null) {
                callback.onCustomViewHidden();
                return;
            }

            fullscreenView = view;
            fullscreenCallback = callback;
            webView.setVisibility(View.GONE);
            rootView.addView(view, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
            ));
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
            enterImmersiveMode();
        }

        @Override
        public void onHideCustomView() {
            exitFullscreenVideo();
        }

        @Override
        public boolean onConsoleMessage(ConsoleMessage message) {
            return super.onConsoleMessage(message);
        }
    }

    private class NativeBridge {
        @JavascriptInterface
        public boolean isPictureInPictureSupported() {
            return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O;
        }

        @JavascriptInterface
        public void enterPictureInPicture() {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
            runOnUiThread(() -> {
                if (fullscreenView != null) {
                    exitFullscreenVideo();
                }
                try {
                    PictureInPictureParams params = new PictureInPictureParams.Builder()
                            .setAspectRatio(new Rational(16, 9))
                            .build();
                    MainActivity.this.enterPictureInPictureMode(params);
                } catch (IllegalStateException error) {
                    Toast.makeText(MainActivity.this, "تعذّر تشغيل وضع الصورة داخل صورة", Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public void requestPortrait() {
            runOnUiThread(MainActivity.this::restorePortraitOrientation);
        }
    }

    private void restorePortraitOrientation() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && isInPictureInPictureMode()) return;
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
    }

    private class CinaroDownloadListener implements DownloadListener {
        @Override
        public void onDownloadStart(String url, String userAgent, String contentDisposition,
                                    String mimetype, long contentLength) {
            openExternal(Uri.parse(url));
        }
    }

    private void openExternal(Uri uri) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            startActivity(intent);
        } catch (ActivityNotFoundException error) {
            Toast.makeText(this, R.string.no_app_for_link, Toast.LENGTH_SHORT).show();
        }
    }

    private void enterImmersiveMode() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_FULLSCREEN |
                    View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            );
        }
    }

    private void exitFullscreenVideo() {
        if (fullscreenView == null) return;
        rootView.removeView(fullscreenView);
        fullscreenView = null;
        webView.setVisibility(View.VISIBLE);
        restorePortraitOrientation();
        configureWindow();
        if (fullscreenCallback != null) {
            fullscreenCallback.onCustomViewHidden();
            fullscreenCallback = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (fullscreenView != null) {
            exitFullscreenVideo();
            return;
        }
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript(
                "(window.CINARO_HANDLE_BACK ? window.CINARO_HANDLE_BACK() : false)",
                result -> {
                    if ("true".equals(result)) return;
                    fallbackBackNavigation();
                }
        );
    }

    private void fallbackBackNavigation() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onPause() {
        webView.onPause();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || !isInPictureInPictureMode()) {
            webView.evaluateJavascript("document.getElementById('videoPlayer')?.pause()", null);
        }
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
        if (fullscreenView == null && (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || !isInPictureInPictureMode())) {
            restorePortraitOrientation();
        }
    }

    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        if (!isInPictureInPictureMode && fullscreenView == null) {
            restorePortraitOrientation();
            webView.evaluateJavascript("window.dispatchEvent(new Event('cinaro:pip-exit'))", null);
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.stopLoading();
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.removeAllViews();
            webView.destroy();
        }
        super.onDestroy();
    }
}
