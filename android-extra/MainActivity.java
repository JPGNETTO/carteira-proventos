package __PACOTE__;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // plugins próprios do app precisam ser registrados antes do super.onCreate
        registerPlugin(SalvarArquivoPlugin.class);
        super.onCreate(savedInstanceState);

        // Botão/gesto de VOLTAR: volta para a tela anterior do app (histórico do WebView).
        // Só fecha o app quando não há mais para onde voltar.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView wv = getBridge() != null ? getBridge().getWebView() : null;
                if (wv != null && wv.canGoBack()) {
                    wv.goBack();
                    return;
                }
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            }
        });
    }
}
