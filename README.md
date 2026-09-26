# TTK Moedas

Sistema de ranking e recompensas para TikTok LIVE.

## Visão geral

Este projeto simula uma interface de live com:

- ranking de seguidores em tempo real;
- contagem de rosas;
- fila de premiação;
- saldo em moedas;
- integração com TikTok LIVE via `tiktok-live-connector`;
- modo local de simulação para testes.

## Instalação

```bash
npm install
```

## Iniciar o projeto

```bash
npm start
```

## Configuração

Crie um arquivo `.env` com base no `.env.example`:

```env
TIKTOK_USERNAME=quiz_azul
PORT=3000
SIMULATION_MODE=false
```

- `TIKTOK_USERNAME`: username da live do TikTok, configurado permanentemente como `quiz_azul`.
- `PORT`: porta do servidor.
- `SIMULATION_MODE=false`: tenta conectar com o TikTok LIVE real automaticamente.
- `SIMULATION_MODE=true`: usa a simulação local.

## Modo simulação

O projeto pode rodar sem autenticação ou cookies usando dados simulados para testar o ranking e a premiação.

## Modo TikTok LIVE

Quando `SIMULATION_MODE=false`, o projeto tentará conectar com a live configurada em `TTK_TIKTOK_USERNAME` usando `tiktok-live-connector`.

## Importante

- Não envie senhas, cookies, tokens ou chaves privadas para o GitHub.
- Use `.gitignore` para evitar arquivos sensíveis.

## Arquitetura simplificada

```text
TikTok Connector
  ↓
Event Manager
  ↓
Ranking Manager
  ↓
Reward Queue
  ↓
Socket.IO
  ↓
Frontend
```
