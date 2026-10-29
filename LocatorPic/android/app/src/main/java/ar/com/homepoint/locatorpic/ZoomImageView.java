package ar.com.homepoint.locatorpic;

import android.content.Context;
import android.graphics.Matrix;
import android.graphics.RectF;
import android.graphics.drawable.Drawable;
import android.util.AttributeSet;
import android.view.GestureDetector;
import android.view.MotionEvent;
import android.view.ScaleGestureDetector;

import androidx.appcompat.widget.AppCompatImageView;

/**
 * Imagen con zoom de pellizco, arrastre y doble toque (para revisar que los
 * precios se lean antes de confirmar la foto).
 */
public class ZoomImageView extends AppCompatImageView {

    private static final float ZOOM_MAX = 6f;

    private final Matrix matriz = new Matrix();
    private final float[] valores = new float[9];
    private float escalaBase = 1f;
    private final ScaleGestureDetector pellizco;
    private final GestureDetector gestos;

    public ZoomImageView(Context ctx, AttributeSet attrs) {
        super(ctx, attrs);
        setScaleType(ScaleType.MATRIX);
        pellizco = new ScaleGestureDetector(ctx, new ScaleGestureDetector.SimpleOnScaleGestureListener() {
            @Override
            public boolean onScale(ScaleGestureDetector d) {
                float actual = escala();
                float factor = d.getScaleFactor();
                float nueva = Math.max(escalaBase, Math.min(escalaBase * ZOOM_MAX, actual * factor));
                factor = nueva / actual;
                matriz.postScale(factor, factor, d.getFocusX(), d.getFocusY());
                acomodar();
                return true;
            }
        });
        gestos = new GestureDetector(ctx, new GestureDetector.SimpleOnGestureListener() {
            @Override
            public boolean onScroll(MotionEvent e1, MotionEvent e2, float dx, float dy) {
                matriz.postTranslate(-dx, -dy);
                acomodar();
                return true;
            }

            @Override
            public boolean onDoubleTap(MotionEvent e) {
                if (escala() > escalaBase * 1.1f) {
                    ajustar();
                } else {
                    float f = 3f;
                    matriz.postScale(f, f, e.getX(), e.getY());
                    acomodar();
                }
                return true;
            }
        });
    }

    @Override
    public void setImageDrawable(Drawable d) {
        super.setImageDrawable(d);
        post(this::ajustar);
    }

    @Override
    protected void onSizeChanged(int w, int h, int ow, int oh) {
        super.onSizeChanged(w, h, ow, oh);
        ajustar();
    }

    @Override
    public boolean onTouchEvent(MotionEvent e) {
        pellizco.onTouchEvent(e);
        gestos.onTouchEvent(e);
        return true;
    }

    /** Muestra la imagen entera, centrada. */
    public void ajustar() {
        Drawable d = getDrawable();
        if (d == null || getWidth() == 0) return;
        float iw = d.getIntrinsicWidth(), ih = d.getIntrinsicHeight();
        escalaBase = Math.min(getWidth() / iw, getHeight() / ih);
        matriz.reset();
        matriz.postScale(escalaBase, escalaBase);
        matriz.postTranslate((getWidth() - iw * escalaBase) / 2f, (getHeight() - ih * escalaBase) / 2f);
        setImageMatrix(matriz);
    }

    private float escala() {
        matriz.getValues(valores);
        return valores[Matrix.MSCALE_X];
    }

    /** Evita que la imagen se vaya fuera de la pantalla. */
    private void acomodar() {
        Drawable d = getDrawable();
        if (d == null) return;
        RectF r = new RectF(0, 0, d.getIntrinsicWidth(), d.getIntrinsicHeight());
        matriz.mapRect(r);
        float dx = 0, dy = 0;
        if (r.width() <= getWidth()) dx = (getWidth() - r.width()) / 2f - r.left;
        else if (r.left > 0) dx = -r.left;
        else if (r.right < getWidth()) dx = getWidth() - r.right;
        if (r.height() <= getHeight()) dy = (getHeight() - r.height()) / 2f - r.top;
        else if (r.top > 0) dy = -r.top;
        else if (r.bottom < getHeight()) dy = getHeight() - r.bottom;
        matriz.postTranslate(dx, dy);
        setImageMatrix(matriz);
    }
}
