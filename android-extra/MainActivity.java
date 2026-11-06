package __PACOTE__;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // plugins próprios do app precisam ser registrados antes do super.onCreate
        registerPlugin(SalvarArquivoPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
