package ar.com.homepoint.locatorpic;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.util.AttributeSet;
import android.view.Surface;
import android.view.View;

/**
 * Nivel de burbuja sobre el visor: una linea que muestra la inclinacion del
 * equipo. Se pone verde cuando esta derecho (menos de 1,5 grados), para que
 * las fotos salgan parejas y el corte entre las dos columnas caiga en el medio.
 */
public class NivelView extends View implements SensorEventListener {

    private static final float TOLERANCIA = 1.5f;

    private final Paint linea = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint marcas = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final SensorManager sensores;
    private final Sensor gravedad;
    private float inclinacion = 0f;   // grados, suavizado

    public NivelView(Context ctx, AttributeSet attrs) {
        super(ctx, attrs);
        linea.setStrokeWidth(dp(2.5f));
        linea.setStrokeCap(Paint.Cap.ROUND);
        marcas.setStrokeWidth(dp(2f));
        marcas.setStrokeCap(Paint.Cap.ROUND);
        marcas.setColor(0x99FFFFFF);
        sensores = (SensorManager) ctx.getSystemService(Context.SENSOR_SERVICE);
        Sensor g = sensores != null ? sensores.getDefaultSensor(Sensor.TYPE_GRAVITY) : null;
        gravedad = g != null ? g : (sensores != null ? sensores.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) : null);
    }

    @Override
    protected void onAttachedToWindow() {
        super.onAttachedToWindow();
        if (gravedad != null) sensores.registerListener(this, gravedad, SensorManager.SENSOR_DELAY_UI);
    }

    @Override
    protected void onDetachedFromWindow() {
        super.onDetachedFromWindow();
        if (sensores != null) sensores.unregisterListener(this);
    }

    @Override
    public void onSensorChanged(SensorEvent e) {
        // Angulo de la gravedad en el plano de la pantalla. Derecho en vertical
        // da 0; en horizontal, -90 o +90 segun hacia que lado se giro el equipo.
        float angulo = (float) Math.toDegrees(Math.atan2(e.values[0], e.values[1]));
        int rot = getDisplay() != null ? getDisplay().getRotation() : Surface.ROTATION_0;
        float esperado;
        switch (rot) {
            case Surface.ROTATION_90: esperado = 90f; break;
            case Surface.ROTATION_270: esperado = -90f; break;
            case Surface.ROTATION_180: esperado = 180f; break;
            default: esperado = 0f;
        }
        float t = angulo - esperado;
        while (t > 180) t -= 360;
        while (t < -180) t += 360;
        inclinacion = inclinacion * 0.8f + t * 0.2f;
        invalidate();
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) { }

    public boolean estaDerecho() {
        return Math.abs(inclinacion) < TOLERANCIA;
    }

    @Override
    protected void onDraw(Canvas c) {
        float cx = getWidth() / 2f, cy = getHeight() / 2f;
        float largo = Math.min(getWidth(), dp(220)) / 2f;
        boolean derecho = estaDerecho();
        linea.setColor(derecho ? 0xFF7CB342 : 0xFFFFFFFF);

        // Marcas fijas a los costados (la referencia de "derecho").
        c.drawLine(cx - largo - dp(18), cy, cx - largo - dp(6), cy, marcas);
        c.drawLine(cx + largo + dp(6), cy, cx + largo + dp(18), cy, marcas);

        // La linea gira con la inclinacion del equipo.
        c.save();
        c.rotate(inclinacion, cx, cy);
        c.drawLine(cx - largo, cy, cx + largo, cy, linea);
        c.restore();
    }

    private float dp(float v) {
        return v * getResources().getDisplayMetrics().density;
    }
}
