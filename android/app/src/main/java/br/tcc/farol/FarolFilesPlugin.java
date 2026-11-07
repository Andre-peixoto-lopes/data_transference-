package br.tcc.farol;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.MimeTypeMap;
import androidx.annotation.RequiresApi;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.Locale;

/** Saves files for the web layer (app/shared/save-file.ts): the WebView ignores {@code <a download>}. */
@CapacitorPlugin(name = "FarolFiles")
public class FarolFilesPlugin extends Plugin {

    private static final int MAX_NAME_LENGTH = 120;

    @PluginMethod
    public void save(PluginCall call) {
        String data = call.getString("data");
        if (data == null) {
            call.reject("nenhum dado para salvar");
            return;
        }
        String name = safeName(call.getString("name", ""));
        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            String location = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                ? saveToDownloads(name, bytes)
                : saveToAppFolder(name, bytes);
            JSObject result = new JSObject();
            result.put("location", location);
            call.resolve(result);
        } catch (IllegalArgumentException | IOException e) {
            call.reject(e.getMessage(), e);
        }
    }

    /** The name arrives over the air (untrusted): keep it a plain, visible file name. */
    static String safeName(String raw) {
        String name = raw.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim().replaceFirst("^\\.+", "");
        if (name.isEmpty()) return "arquivo-farol";
        if (name.length() <= MAX_NAME_LENGTH) return name;
        int dot = name.lastIndexOf('.');
        String extension = dot > 0 && name.length() - dot <= 10 ? name.substring(dot) : "";
        return name.substring(0, MAX_NAME_LENGTH - extension.length()) + extension;
    }

    private static String mimeTypeOf(String name) {
        int dot = name.lastIndexOf('.');
        String type = dot < 0 ? null : MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substring(dot + 1).toLowerCase(Locale.ROOT));
        return type != null ? type : "application/octet-stream";
    }

    @RequiresApi(Build.VERSION_CODES.Q)
    private String saveToDownloads(String name, byte[] bytes) throws IOException {
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        values.put(MediaStore.MediaColumns.MIME_TYPE, mimeTypeOf(name));
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (uri == null) throw new IOException("a pasta Downloads recusou o arquivo");
        try (OutputStream out = resolver.openOutputStream(uri)) {
            if (out == null) throw new IOException("sem acesso ao arquivo criado");
            out.write(bytes);
        } catch (IOException e) {
            resolver.delete(uri, null, null);
            throw e;
        }
        values.clear();
        values.put(MediaStore.MediaColumns.IS_PENDING, 0);
        resolver.update(uri, values, null, null);
        // MediaStore renames on collision ("nome (1).pdf"): report the name it actually used.
        try (Cursor cursor = resolver.query(uri, new String[] { MediaStore.MediaColumns.DISPLAY_NAME }, null, null, null)) {
            return "Downloads/" + (cursor != null && cursor.moveToFirst() ? cursor.getString(0) : name);
        }
    }

    /** Android 7-9: no MediaStore.Downloads; the app's own folder needs no storage permission. */
    private String saveToAppFolder(String name, byte[] bytes) throws IOException {
        File dir = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (dir == null || !(dir.isDirectory() || dir.mkdirs())) throw new IOException("armazenamento indisponível");
        int dot = name.lastIndexOf('.');
        String stem = dot > 0 ? name.substring(0, dot) : name;
        String extension = dot > 0 ? name.substring(dot) : "";
        File file = new File(dir, name);
        for (int n = 1; file.exists(); n++) file = new File(dir, stem + " (" + n + ")" + extension);
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(bytes);
        }
        return file.getAbsolutePath();
    }
}
