# NEXUS Compra & Ticket — GitHub + Tampermonkey

Pacote preparado para o repositório **jhonesfeliciano/nexus-compra-ticket**.

## Estrutura

```text
manifest.json
loaders/
  NEXUS_COMPRA_TICKET_LOADER_TERESINA.user.js
  NEXUS_COMPRA_TICKET_LOADER_PALMAS.user.js
  NEXUS_COMPRA_TICKET_LOADER_MATRIZ.user.js
releases/
  1.3.0/
    teresina/nexus-compra-ticket-teresina.js
    palmas/nexus-compra-ticket-palmas.js
original/
  SCRIPT_ORIGINAL_v1.2.0.txt
```

## O que mudou em relação ao script original

- O código principal passou a ficar em `releases/` no GitHub.
- `manifest.json` define qual versão TERESINA e PALMAS devem usar.
- Existem loaders exclusivos para TERESINA e PALMAS e um loader universal da MATRIZ.
- Os loaders estão pré-configurados para `jhonesfeliciano/nexus-compra-ticket`.
- A janela **Compra & Ticket só aparece quando a grade correta de Cobranças está realmente presente**, identificada pelas colunas Semana, Região, Total e Ticket Médio. Nas outras páginas APEX o loader fica silenciosamente inativo.
- O painel carrega os distribuidores do ecossistema correto em `Ciclo-semanas-setores/<perfil>/profiles`.
- Solicitações são aceitas apenas quando `type = purchaseMetrics`, evitando confusão com a integração de Notas Perdidas que compartilha `Ciclo-semanas-integracao`.
- O Loader MATRIZ usa `ecosystemKey` da solicitação quando disponível e, como fallback, identifica o distribuidor nas listas de TERESINA/PALMAS.
- Cache local e validação SHA-256 foram mantidos.

## Instalação resumida

1. Crie no GitHub um repositório público chamado `nexus-compra-ticket` no usuário `jhonesfeliciano`.
2. Envie para a raiz do repositório: `manifest.json`, `loaders/`, `releases/` e, se quiser, os arquivos de documentação.
3. No Tampermonkey instale **somente um** dos loaders conforme a máquina: TERESINA, PALMAS ou MATRIZ.
4. Não instale os arquivos de `releases/` diretamente no Tampermonkey; eles são baixados pelo loader.
5. Os loaders deste projeto podem coexistir com os loaders do outro projeto Nexus porque usam nomes, cache e ativação de página diferentes.

## Atualizações futuras

Crie uma nova pasta, por exemplo `releases/1.4.0/...`, envie os novos arquivos e só então altere `manifest.json`. Uma versão enviada para `releases/` não fica ativa até o manifesto apontar para ela.
