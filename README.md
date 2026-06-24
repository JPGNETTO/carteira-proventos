# 📱 Carteira Proventos — App Android

Este projeto transforma exatamente as telas que criamos (Gráfico, Ranking e Cenário Futuro) em um aplicativo Android instalável (.apk).

---

## O que você vai precisar instalar (uma vez só)

1. **Node.js** (versão 18 ou maior) → https://nodejs.org — baixe a versão "LTS"
2. **Android Studio** → https://developer.android.com/studio — é o programa da Google que gera o APK
3. **Java JDK 17** → normalmente já vem junto com o Android Studio

Não precisa saber programar. É só seguir os comandos abaixo, um de cada vez.

---

## Passo a passo

Abra o **Terminal** (no Windows: "Prompt de Comando" ou "PowerShell") dentro da pasta `carteira-app` e digite os comandos abaixo, um por vez, apertando Enter depois de cada um.

### 1. Instalar as dependências do projeto
```
npm install
```
Isso baixa o React, o Recharts e o Capacitor. Demora 1-2 minutos.

### 2. Gerar a versão web otimizada
```
npm run build
```
Isso cria a pasta `dist` com o app pronto.

### 3. Adicionar a plataforma Android
```
npx cap add android
```
Isso cria a pasta `android` com o projeto nativo.

### 4. Sincronizar o código com o Android
```
npx cap sync android
```

### 5. Abrir no Android Studio
```
npx cap open android
```
Isso abre o Android Studio automaticamente. Na primeira vez, ele vai baixar alguns componentes — deixe ele terminar (pode levar alguns minutos).

### 6. Gerar o APK
Dentro do Android Studio:
- Menu superior: **Build** → **Build Bundle(s) / APK(s)** → **Build APK(s)**
- Quando terminar, aparece uma notificação no canto inferior direito com um link **"locate"** — clique nele
- O arquivo `app-debug.apk` estará lá. Esse é o seu app!

### 7. Instalar no celular
- Passe o arquivo `.apk` para o seu celular (WhatsApp, cabo USB, Google Drive, etc.)
- No celular, toque no arquivo para instalar
- Talvez precise ativar "Permitir instalação de fontes desconhecidas" nas configurações — o Android avisa e te leva direto pra opção

Pronto! O app abre igualzinho às telas que fizemos. 🎉

---

## Atualizar o app depois de mudanças

Sempre que quiser mudar algo no `src/App.jsx`, é só rodar:
```
npm run build
npx cap sync android
```
E gerar o APK de novo (passo 6).

Ou use o atalho que já deixei pronto:
```
npm run android:run
```
(isso faz build + sync + roda no celular conectado de uma vez)

---

## Quer testar no navegador antes?

Sem precisar de Android Studio, dá pra ver no computador:
```
npm install
npm run dev
```
Abre no navegador em `http://localhost:5173`.

---

## Estrutura do projeto

```
carteira-app/
├── src/
│   ├── App.jsx        ← TODO o código das telas (igual ao proventos12m.jsx)
│   └── main.jsx       ← ponto de entrada
├── index.html         ← página base com tema escuro
├── package.json       ← dependências e comandos
├── vite.config.js     ← configuração de build
├── capacitor.config.ts← configuração do app (nome, ID, cor de fundo)
└── README.md          ← este arquivo
```

---

## Caminhos alternativos (se quiser considerar)

| Opção | Vantagem | Desvantagem |
|---|---|---|
| **Capacitor** (este projeto) | Usa exatamente o código atual, vira APK de verdade | Precisa do Android Studio instalado |
| **PWA** (Progressive Web App) | Não precisa de Android Studio; "instala" pelo navegador | Não fica na Play Store; ícone vem do navegador |
| **Publicar na Play Store** | Qualquer um baixa pela loja | Taxa única de US$25 e processo de revisão da Google |

Para uso pessoal, o Capacitor (gerar o APK e instalar direto) é o caminho mais simples e completo.

---

## Observação importante sobre os dados

Os valores de proventos por cota usados na projeção são estimativas baseadas nos últimos pagamentos conhecidos (jun/2026). Eles ficam no início do arquivo `src/App.jsx`, na constante `ATIVOS` — você pode editar os números de `prov` (provento por cota) e `cotacao` conforme quiser atualizar.
