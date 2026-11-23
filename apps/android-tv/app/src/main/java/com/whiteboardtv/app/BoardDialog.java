package com.whiteboardtv.app;

import android.animation.ArgbEvaluator;
import android.animation.ValueAnimator;
import android.app.Activity;
import android.app.Dialog;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.view.animation.DecelerateInterpolator;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/** Native actions use the same card, typography and focus treatment as the TV member panel. */
final class BoardDialog {
    private static final int INK = Color.rgb(23, 32, 51);
    private static final int BLUE = Color.rgb(49, 94, 251);
    private static final int SURFACE = Color.rgb(242, 244, 248);
    private BoardDialog() {}

    static Dialog show(Activity activity, String title, String message, String[] labels, Runnable[] actions) {
        if (labels.length != actions.length || labels.length == 0) throw new IllegalArgumentException("Dialog actions required");
        float density = activity.getResources().getDisplayMetrics().density;
        int inset = Math.round(24 * density);
        Dialog dialog = new Dialog(activity);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        dialog.setTitle(title);
        dialog.setCanceledOnTouchOutside(false);
        LinearLayout card = new LinearLayout(activity);
        card.setOrientation(LinearLayout.VERTICAL); card.setPadding(inset, inset, inset, inset);
        TextView heading = new TextView(activity); heading.setText(title); heading.setTextSize(26);
        heading.setTextColor(INK); heading.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        heading.setIncludeFontPadding(false);
        card.addView(heading, new LinearLayout.LayoutParams(-1, -2));
        if (!message.isEmpty()) {
            TextView detail = new TextView(activity); detail.setText(message); detail.setTextSize(18);
            detail.setTextColor(Color.rgb(102, 112, 133)); detail.setIncludeFontPadding(false);
            detail.setLineSpacing(4 * density, 1);
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2); params.topMargin = Math.round(12 * density);
            card.addView(detail, params);
        }
        Button[] buttons = new Button[labels.length];
        for (int i = 0; i < labels.length; i++) {
            Button button = new Button(activity); buttons[i] = button; button.setId(View.generateViewId());
            button.setText(labels[i]); button.setTextSize(18); button.setAllCaps(false);
            button.setGravity(Gravity.CENTER_VERTICAL | Gravity.START); button.setIncludeFontPadding(false);
            button.setStateListAnimator(null); button.setMinHeight(0); button.setMinimumHeight(0);
            button.setPadding(Math.round(18 * density), 0, Math.round(18 * density), 0);
            styleButton(button, SURFACE, density);
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, Math.round(52 * density));
            params.topMargin = Math.round((i == 0 ? 16 : 10) * density); card.addView(button, params);
            Runnable action = actions[i]; button.setOnClickListener(view -> { dialog.dismiss(); action.run(); });
        }
        for (int i = 0; i < buttons.length; i++) {
            buttons[i].setNextFocusUpId(buttons[Math.max(0, i - 1)].getId());
            buttons[i].setNextFocusDownId(buttons[Math.min(buttons.length - 1, i + 1)].getId());
            buttons[i].setNextFocusLeftId(buttons[i].getId()); buttons[i].setNextFocusRightId(buttons[i].getId());
        }
        final int maxHeight = activity.getResources().getDisplayMetrics().heightPixels - 2 * inset;
        ScrollView scroll = new ScrollView(activity) {
            @Override protected void onMeasure(int widthSpec, int heightSpec) {
                super.onMeasure(widthSpec, View.MeasureSpec.makeMeasureSpec(maxHeight, View.MeasureSpec.AT_MOST));
            }
        };
        scroll.setFillViewport(false); scroll.setClipToOutline(true);
        GradientDrawable surface = new GradientDrawable(); surface.setColor(Color.WHITE); surface.setCornerRadius(18 * density);
        scroll.setBackground(surface); scroll.addView(card);
        dialog.setContentView(scroll);
        dialog.setOnKeyListener((d, key, event) -> {
            if (key != KeyEvent.KEYCODE_MENU) return false;
            if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) dialog.dismiss();
            return true;
        });
        Window window = dialog.getWindow();
        if (window != null) {
            window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
            window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
            window.setDimAmount(.33f); window.setGravity(Gravity.CENTER);
            window.setWindowAnimations(ValueAnimator.areAnimatorsEnabled() ? R.style.BoardDialogAnimation : 0);
        }
        dialog.show();
        if (window != null) {
            window.setLayout(Math.min(Math.round(440 * density), activity.getResources().getDisplayMetrics().widthPixels - 2 * inset), -2);
            window.getDecorView().setSystemUiVisibility(activity.getWindow().getDecorView().getSystemUiVisibility());
        }
        buttons[0].requestFocus();
        return dialog;
    }

    static void styleButton(Button button, int baseColor, float density) {
        GradientDrawable background = new GradientDrawable(); background.setCornerRadius(12 * density); background.setColor(baseColor);
        button.setBackground(background); button.setTextColor(INK);
        ValueAnimator[] animator = new ValueAnimator[1];
        ArgbEvaluator colors = new ArgbEvaluator();
        button.setOnFocusChangeListener((view, focused) -> {
            if (animator[0] != null) animator[0].cancel();
            int from = background.getColor().getDefaultColor(), fromText = button.getCurrentTextColor();
            int to = focused ? BLUE : baseColor, toText = focused ? Color.WHITE : INK;
            if (!ValueAnimator.areAnimatorsEnabled()) { background.setColor(to); button.setTextColor(toText); return; }
            ValueAnimator next = ValueAnimator.ofFloat(0, 1); animator[0] = next;
            next.setDuration(200); next.setInterpolator(new DecelerateInterpolator());
            next.addUpdateListener(value -> {
                float fraction = (float)value.getAnimatedValue();
                background.setColor((int)colors.evaluate(fraction, from, to));
                button.setTextColor((int)colors.evaluate(fraction, fromText, toText));
            });
            next.start();
        });
        button.addOnAttachStateChangeListener(new View.OnAttachStateChangeListener() {
            @Override public void onViewAttachedToWindow(View view) { }
            @Override public void onViewDetachedFromWindow(View view) { if (animator[0] != null) animator[0].cancel(); }
        });
    }
}
