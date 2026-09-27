# TTK Moedas

Ranking manual de jogadores e moedas, com atualização em tempo real.

## Iniciar

```bash
npm install
npm start
```

Abra `http://localhost:3000` para o ranking e `http://localhost:3000/admin` para o painel administrativo. A porta pode ser alterada pela variável `PORT`.

## Dados e atualização

Os jogadores são armazenados em `data/players.json`, no servidor. Esse arquivo é criado automaticamente e fica fora do Git. Para usar outro caminho, defina `PLAYERS_FILE`.

As rotas `GET`, `POST`, `PUT` e `DELETE /api/players` gerenciam o cadastro. O ajuste de saldo usa `POST /api/players/:id/coins` com `operation` igual a `add` ou `remove` e `amount` inteiro positivo. Alterações são persistidas antes de serem transmitidas aos clientes conectados por Socket.IO.

As integrações e a entrada automática de pontos do TikTok estão desativadas nesta versão manual. O painel não tem autenticação e deve ser usado apenas em ambiente local ou em uma rede confiável; a rota de administração pode receber autenticação posteriormente.
