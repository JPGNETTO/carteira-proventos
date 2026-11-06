package __PACOTE__;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Abre a janela "Salvar como" do Android (Storage Access Framework):
 * o usuário escolhe a pasta e o nome, e o app grava o conteúdo lá.
 * Uso no JS: SalvarArquivo.salvar({ nome, conteudo, mime }) -> { salvo, cancelado, uri }
 */
@CapacitorPlugin(name = "SalvarArquivo")
public class SalvarArquivoPlugin extends Plugin {

    @PluginMethod
    public void salvar(PluginCall call) {
        String nome = call.getString("nome", "backup.json");
        String mime = call.getString("mime", "application/json");
        if (call.getString("conteudo") == null) {
            call.reject("Nada para salvar");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mime);
        intent.putExtra(Intent.EXTRA_TITLE, nome);
        startActivityForResult(call, intent, "aoEscolherLocal");
    }

    @ActivityCallback
    private void aoEscolherLocal(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent dados = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || dados == null || dados.getData() == null) {
            JSObject r = new JSObject();
            r.put("salvo", false);
            r.put("cancelado", true);
            call.resolve(r);
            return;
        }
        Uri uri = dados.getData();
        try (OutputStream out = getContext().getContentResolver().openOutputStream(uri, "w")) {
            if (out == null) throw new Exception("não foi possível abrir o arquivo escolhido");
            out.write(call.getString("conteudo", "").getBytes(StandardCharsets.UTF_8));
            out.flush();
            JSObject r = new JSObject();
            r.put("salvo", true);
            r.put("uri", uri.toString());
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Erro ao salvar: " + e.getMessage(), e);
        }
    }
}
