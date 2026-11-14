# Configuração operacional — 12/11/2026

## Thiago-PC

- Windows 10 Pro 22H2 (build 19045), Ryzen 5 3400G, 16 GiB RAM.
- Node 20.20.2, npm 10.8.2, Python 3.13, Git 2.53, PowerShell 7.6.9, Tailscale 1.102.4.
- Playwright 1.65 e Chromium instalados localmente.
- SQLite usa sql.js WASM, sem dependência de compilador C++.
- Perfil da Amazon usa pasta exclusiva em data/amazon-profile. .env e data têm ACL restrita ao usuário atual.

## Pedido

- Página de rastreamento aberta no Brave verificada em modo somente leitura.
- Produto: Grand Theft Auto VI para PlayStation 5.
- Estado visível e registrado como linha de base: Pedido feito.
- Identificador, ASIN e URL estão apenas no .env privado; nenhum endereço foi salvo.

## A30

- Galaxy A30 SM-A305GT ligado e autorizado pelo ADB USB (`RQ8M70A9WBP`).
- Baileys do projeto `bom-dia` está online no PM2; `enabled=false` mantém a agenda diária desligada.
- Ponte HTTP Baileys ativa em `127.0.0.1:18761` no Termux, alcançada do PC por `adb forward`.
- O token está somente no `.env` local e no arquivo privado do watcher no A30; não foi registrado em logs.
- O pacote Winterhold foi desativado e suspenso a pedido do usuário; nenhuma notificação ativa dele permanece.
- A Tailnet do A30 aparece offline, portanto o encaminhamento operacional atual é ADB USB.
- A mensagem de ativação do monitoramento foi enviada pela ponte e recebeu confirmação do Baileys.
- A previsão de entrega é acompanhada independentemente do estado do pedido; mudanças criam notificações persistentes no outbox.

## Testes e pendências

- O login manual do perfil Amazon foi concluído e a última leitura real confirmou “Pedido feito”.
- O Agendador do Windows mantém o monitor local ativo; o intervalo configurado é 1 minuto.
- A ponte ADB é reafirmada antes de cada checagem; falha de conexão deixa notificações em fila para nova tentativa.
