package ar.com.homepoint.locatorpic;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Matrix;

import androidx.exifinterface.media.ExifInterface;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;

/** Utilidades de imagen: leer derecho (segun la orientacion de la camara), miniaturas y control de calidad. */
public final class Imagenes {

    private Imagenes() {}

    /** Grados que hay que girar la foto para verla derecha (dato EXIF que escribe CameraX). */
    public static int rotacion(File archivo) {
        try {
            int o = new ExifInterface(archivo.getAbsolutePath())
                    .getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
            switch (o) {
                case ExifInterface.ORIENTATION_ROTATE_90: return 90;
                case ExifInterface.ORIENTATION_ROTATE_180: return 180;
                case ExifInterface.ORIENTATION_ROTATE_270: return 270;
                default: return 0;
            }
        } catch (IOException e) {
            return 0;
        }
    }

    /** {ancho, alto} de la foto ya derecha, sin cargarla en memoria. */
    public static int[] dimensiones(File archivo) {
        BitmapFactory.Options op = new BitmapFactory.Options();
        op.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(archivo.getAbsolutePath(), op);
        int r = rotacion(archivo);
        return (r == 90 || r == 270) ? new int[]{op.outHeight, op.outWidth} : new int[]{op.outWidth, op.outHeight};
    }

    /** Carga la foto achicada (lado mayor <= ladoMax aprox.) y derecha. */
    public static Bitmap cargar(File archivo, int ladoMax) {
        BitmapFactory.Options op = new BitmapFactory.Options();
        op.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(archivo.getAbsolutePath(), op);
        int mayor = Math.max(op.outWidth, op.outHeight);
        int muestra = 1;
        while (mayor / (muestra * 2) >= ladoMax) muestra *= 2;
        op = new BitmapFactory.Options();
        op.inSampleSize = muestra;
        Bitmap bmp = BitmapFactory.decodeFile(archivo.getAbsolutePath(), op);
        if (bmp == null) return null;
        int r = rotacion(archivo);
        if (r == 0) return bmp;
        Matrix m = new Matrix();
        m.postRotate(r);
        Bitmap girada = Bitmap.createBitmap(bmp, 0, 0, bmp.getWidth(), bmp.getHeight(), m, true);
        if (girada != bmp) bmp.recycle();
        return girada;
    }

    /** Guarda una miniatura JPEG (unos 480 px, ~40 KB): es la foto guia de la semana siguiente. */
    public static void miniatura(File origen, File destino, int lado) throws IOException {
        Bitmap bmp = cargar(origen, lado * 2);
        if (bmp == null) throw new IOException("No se pudo leer la foto");
        float escala = (float) lado / Math.max(bmp.getWidth(), bmp.getHeight());
        Bitmap chica = Bitmap.createScaledBitmap(bmp, Math.round(bmp.getWidth() * escala),
                Math.round(bmp.getHeight() * escala), true);
        File dir = destino.getParentFile();
        if (dir != null && !dir.exists() && !dir.mkdirs()) throw new IOException("No se pudo crear " + dir);
        try (FileOutputStream out = new FileOutputStream(destino)) {
            chica.compress(Bitmap.CompressFormat.JPEG, 80, out);
        }
        if (chica != bmp) chica.recycle();
        bmp.recycle();
    }

    /**
     * Control rapido de calidad sobre una version chica de la foto.
     * nitidez: varianza del laplaciano (bajo = borrosa o movida).
     * brillo: promedio de 0 a 255 (bajo = oscura).
     */
    public static float[] calidad(Bitmap bmp) {
        int lado = 400;
        float escala = (float) lado / Math.max(bmp.getWidth(), bmp.getHeight());
        Bitmap b = Bitmap.createScaledBitmap(bmp, Math.max(1, Math.round(bmp.getWidth() * escala)),
                Math.max(1, Math.round(bmp.getHeight() * escala)), true);
        int w = b.getWidth(), h = b.getHeight();
        int[] px = new int[w * h];
        b.getPixels(px, 0, w, 0, 0, w, h);
        if (b != bmp) b.recycle();

        float[] gris = new float[w * h];
        double sumaBrillo = 0;
        for (int i = 0; i < px.length; i++) {
            int c = px[i];
            gris[i] = 0.299f * Color.red(c) + 0.587f * Color.green(c) + 0.114f * Color.blue(c);
            sumaBrillo += gris[i];
        }
        double suma = 0, suma2 = 0;
        int n = 0;
        for (int y = 1; y < h - 1; y++) {
            for (int x = 1; x < w - 1; x++) {
                int i = y * w + x;
                float lap = 4 * gris[i] - gris[i - 1] - gris[i + 1] - gris[i - w] - gris[i + w];
                suma += lap;
                suma2 += lap * lap;
                n++;
            }
        }
        double media = n > 0 ? suma / n : 0;
        double varianza = n > 0 ? suma2 / n - media * media : 0;
        return new float[]{(float) varianza, (float) (sumaBrillo / px.length)};
    }
}
