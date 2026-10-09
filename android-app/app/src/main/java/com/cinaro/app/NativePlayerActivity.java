package com.cinaro.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.PictureInPictureParams;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.util.Rational;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.widget.Toast;

import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;

@UnstableApi
public class NativePlayerActivity extends Activity {
    public static final String EXTRA_URL = "cinaro_player_url";
    public static final String EXTRA_TITLE = "cinaro_player_title";
    public static final String EXTRA_TYPE = "cinaro_player_type";

    private ExoPlayer player;
    private PlayerView playerView;
    private final Handler stallHandler = new Handler(Looper.getMainLooper());
    private final Runnable stallTimeout = () -> showPlaybackError("انتهت مهلة تحميل الفيديو. تحقق من الاتصال أو جرّب مصدرًا آخر.");
    private boolean errorDialogVisible = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.BLACK);
        getWindow().setNavigationBarColor(Color.BLACK);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        enterImmersiveMode();

        String url = getIntent().getStringExtra(EXTRA_URL);
        if (!isSafeMediaUrl(url)) {
            Toast.makeText(this, "رابط الفيديو غير صالح", Toast.LENGTH_SHORT).show();
            finish();
            return;
        }

        try {
            playerView = new PlayerView(this);
            playerView.setUseController(true);
            playerView.setControllerAutoShow(true);
            playerView.setKeepScreenOn(true);
            playerView.setBackgroundColor(Color.BLACK);
            setContentView(playerView);

            player = new ExoPlayer.Builder(this).build();
            playerView.setPlayer(player);
            player.addListener(new Player.Listener() {
                @Override
                public void onPlaybackStateChanged(int state) {
                    if (state == Player.STATE_BUFFERING) {
                        scheduleStallTimeout();
                    } else {
                        stallHandler.removeCallbacks(stallTimeout);
                    }
                }

                @Override
                public void onPlayerError(PlaybackException error) {
                    Log.e("CINARO_PLAYER", "Playback error code: " + error.errorCode, error);
                    showPlaybackError("تعذّر تشغيل الفيديو. قد يكون الرابط غير متاح أو الترميز غير مدعوم.");
                }
            });

            MediaItem.Builder itemBuilder = new MediaItem.Builder()
                    .setUri(Uri.parse(url))
                    .setMediaId("cinaro-stream");
            String type = getIntent().getStringExtra(EXTRA_TYPE);
            if ("hls".equalsIgnoreCase(type)) {
                itemBuilder.setMimeType(MimeTypes.APPLICATION_M3U8);
            }
            player.setMediaItem(itemBuilder.build());
            player.prepare();
            player.setPlayWhenReady(true);
        } catch (RuntimeException error) {
            Log.e("CINARO_PLAYER", "Native player initialization failed", error);
            showPlaybackError("تعذّر بدء مشغل الفيديو على هذا الجهاز.");
        }
    }

    private void scheduleStallTimeout() {
        stallHandler.removeCallbacks(stallTimeout);
        if (!isFinishing()) stallHandler.postDelayed(stallTimeout, 25000L);
    }

    private void showPlaybackError(String message) {
        stallHandler.removeCallbacks(stallTimeout);
        if (isFinishing() || isDestroyed() || errorDialogVisible) return;
        errorDialogVisible = true;
        if (player != null) player.pause();
        new AlertDialog.Builder(this)
                .setTitle("مشكلة في تشغيل الفيديو")
                .setMessage(message)
                .setCancelable(false)
                .setPositiveButton("إعادة المحاولة", (dialog, which) -> {
                    errorDialogVisible = false;
                    if (player == null) {
                        finish();
                        return;
                    }
                    try {
                        player.seekToDefaultPosition();
                        player.prepare();
                        player.play();
                    } catch (RuntimeException error) {
                        Log.e("CINARO_PLAYER", "Playback retry failed", error);
                        finish();
                    }
                })
                .setNegativeButton("العودة إلى CINARO", (dialog, which) -> finish())
                .show();
    }

    private boolean isSafeMediaUrl(String value) {
        if (value == null || value.trim().isEmpty()) return false;
        try {
            Uri uri = Uri.parse(value.trim());
            return "https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null;
        } catch (Exception error) {
            return false;
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

    @Override
    public void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || player == null || !player.isPlaying()) return;
        try {
            PictureInPictureParams params = new PictureInPictureParams.Builder()
                    .setAspectRatio(new Rational(16, 9))
                    .build();
            enterPictureInPictureMode(params);
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onPictureInPictureModeChanged(boolean inPictureInPictureMode, Configuration newConfig) {
        super.onPictureInPictureModeChanged(inPictureInPictureMode, newConfig);
        if (playerView != null) playerView.setUseController(!inPictureInPictureMode);
        if (!inPictureInPictureMode) enterImmersiveMode();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (player != null && (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || !isInPictureInPictureMode())) {
            player.pause();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        enterImmersiveMode();
    }

    @Override
    protected void onDestroy() {
        stallHandler.removeCallbacks(stallTimeout);
        if (playerView != null) playerView.setPlayer(null);
        if (player != null) {
            player.release();
            player = null;
        }
        super.onDestroy();
    }
}
