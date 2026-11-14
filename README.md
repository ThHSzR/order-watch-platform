# Amazon Order Watcher — Thiago-PC

Watcher local em Windows para o status do pedido GTA VI. Usa um perfil Chromium exclusivo; o login e o MFA são manuais e a aplicação lê somente a página configurada. As notificações usam a ponte Baileys do A30 encaminhada por ADB USB.

## Estado atual

- Diagnóstico local concluído: Windows 10 Pro, Node 20.20.2, npm 10.8.2.
- O perfil Chromium exclusivo foi autenticado manualmente e validado com uma leitura real: GTA VI para PS5 em “Pedido feito”.
- Parser, máquina de estados, SQLite, deduplicação e fila persistente implementados.
- Playwright e Chromium instalados; os testes locais passaram.
- O watcher está ativo no Agendador do Windows, consultando a página a cada minuto.
- A ponte Baileys foi validada pelo ADB USB e a mensagem de ativação foi confirmada pelo A30.
- A previsão de entrega é salva separadamente; uma alteração gera alerta mesmo se o estado do pedido não mudar.
- Eventos novos da linha do tempo de rastreamento geram alertas individuais, deduplicados entre as checagens. A primeira leitura cria a linha de base sem reenviar eventos antigos.
- Se a Amazon pedir autenticação, o watcher abre o Chromium imediatamente e espera pela autenticação automática. Só envia aviso pelo WhatsApp se a 3ª checagem consecutiva continuar exigindo autenticação; ao recuperar a sessão, zera o contador.

## Login manual e operação

    npm run auth
    npm run check
    npm start -- status
    npm start -- run

auth abre o perfil isolado e espera até 60 minutos pelo login/MFA. A senha não é solicitada no terminal. Verificações de segurança são concluídas manualmente; o watcher não tenta contorná-las. run consulta a cada minuto; a página da Amazon não fornece eventos push ao watcher, então o atraso mínimo inclui o próximo ciclo de consulta.

## Reuso em outros monitores

O repositório inclui o pacote compartilhado `packages/order-watch-core`, com loop de polling abortável, chaves estáveis para deduplicação de eventos e política de alerta após falhas consecutivas de autenticação. Adaptadores de site, armazenamento e notificações permanecem responsabilidade de cada aplicação.

Estados reconhecidos: Pedido feito/confirmado, preparando, enviado, saiu para entrega, entregue e cancelado. A primeira leitura do status, da previsão e da linha do tempo é a linha de base; alterações posteriores da previsão e cada novo evento de rastreamento geram mensagens próprias, mesmo com o status do pedido inalterado. Estados desconhecidos e falhas preservam os últimos dados confiáveis.

## Ponte Baileys

O .env usa `http://127.0.0.1:18761/send`, autenticado com o token privado do A30. O ADB reafirma o encaminhamento antes de cada consulta. A ponte deve responder com receiptId. Falha de conexão mantém alertas pendentes; timeout ambíguo fica em uncertain para evitar duplicação.

    npm start -- outbox
    npm start -- flush

## Persistência no Windows

scripts/install.ps1 registra uma tarefa do Agendador para a sessão interativa do usuário, com recuperação após falha. O monitoramento pausa ao expirar o login Amazon ou surgir uma verificação; autentique novamente e reinicie a tarefa.

    .\scripts\install.ps1
    .\scripts\start.ps1
    .\scripts\health.ps1
    .\scripts\stop.ps1

.env, o perfil do Chromium, o banco e os logs estão excluídos do Git. O PC precisa estar ligado e acordado. Para encerrar o projeto temporário, pare e remova a tarefa e então apague a pasta do watcher.
