package com.cinaro.app;

import android.app.Application;
import android.content.Intent;

import com.onesignal.OneSignal;
import com.onesignal.notifications.INotificationClickEvent;
import com.onesignal.notifications.INotificationClickListener;

import org.json.JSONObject;

public class CinaroApplication extends Application {
    public static final String EXTRA_NOTIFICATION_ROUTE = "cinaro_notification_route";

    @Override
    public void onCreate() {
        super.onCreate();

        if (!BuildConfig.ENABLE_PUSH) {
            return;
        }

        OneSignal.initWithContext(this, BuildConfig.ONESIGNAL_APP_ID);
        OneSignal.getNotifications().addClickListener(new INotificationClickListener() {
            @Override
            public void onClick(INotificationClickEvent event) {
                JSONObject data = event.getNotification().getAdditionalData();
                String route = data == null ? "home" : data.optString("route", "home");

                Intent intent = new Intent(CinaroApplication.this, MainActivity.class);
                intent.putExtra(EXTRA_NOTIFICATION_ROUTE, route);
                intent.addFlags(
                        Intent.FLAG_ACTIVITY_NEW_TASK |
                        Intent.FLAG_ACTIVITY_CLEAR_TOP |
                        Intent.FLAG_ACTIVITY_SINGLE_TOP
                );
                startActivity(intent);
            }
        });
    }
}
