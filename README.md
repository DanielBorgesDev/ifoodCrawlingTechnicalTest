# iFood Crawler / Scraper

Solução escalável desenvolvida para extrair dados estruturados de páginas de produtos do iFood. A arquitetura foi projetada visando concorrência, tolerância a falhas e superação de bloqueios (WAF/Cloudflare) para garantir alta taxa de sucesso.

## Arquitetura e Soluções Adotadas

1. **Puppeteer Cluster**: Utilizado para gerenciar uma fila de URLs concorrentes (concorrência configurada para 5 páginas simultâneas, otimizável conforme hardware).
2. **Puppeteer Stealth Plugin**: Mascara a automação headless, contornando bloqueios de Anti-Bot (como Cloudflare) de forma transparente.
3. **Mecanismo de Retentativas (Retries)**: Cada URL pode falhar por instabilidade de rede ou bloqueios severos. O Cluster automaticamente tenta recolocar a URL na fila em caso de falha de conexão (até 3 tentativas por link).
4. **Otimização de Carregamento**: O script intercepta a rede e bloqueia o download de mídias pesadas (`image`, `media`, `font`, `stylesheet`), economizando banda e processamento, o que diminui drastically o tempo médio por URL.
5. **Evidências Fotográficas**: Em caso de falha não tratável ou na captura das primeiras páginas de sucesso, um screenshot é salvo no diretório `evidences/`.
6. **Retomada de Processamento (Resume)**: O script lê o arquivo `produtos_extraidos.json` na inicialização e pula automaticamente as URLs que já foram processadas.
7. **Arquitetura Modular**: O código foi completamente componentizado. A raiz possui apenas o orquestrador `scraper.js`, enquanto a lógica pesada reside na pasta `src/` (isolando configurações, validações de rede, extração de DOM e manipulação de arquivos).

## Métricas e Avaliação de Sucesso

O sistema foi arquitetado para atingir a meta mínima de **95% de taxa de sucesso**. O cálculo é realizado internamente no final da execução utilizando a fórmula:
```text
Taxa de Sucesso = (Quantidade de URLs processadas com sucesso / Total de URLs processadas) * 100
```

### Tratamento de URLs Inválidas ou Produtos Indisponíveis
Páginas que exibem avisos como "Produto não encontrado", "Página indisponível" ou em que a estrutura HTML do produto foi completamente removida **não geram quebra do sistema**.
Esses casos são interceptados, ignorados na contagem de "sucesso", mas devidamente registrados no arquivo final de saída para manter a integridade dos dados, recebendo a marcação:
- `"status": "error"`
- `"error_message": "Produto indisponível ou estrutura da página não reconhecida"`

## Estrutura do Output
Os produtos processados são salvos incrementalmente no arquivo `produtos_extraidos.json`, com a seguinte estrutura:
```json
[
  {
    "title": "Combo X-Burger",
    "normal_price": "R$ 39,90",
    "discount_price": "R$ 29,90",
    "product_url": "https://www.ifood.com.br/...",
    "image_url": "https://static.ifood-static.com.br/...",
    "status": "success",
    "error_message": null
  }
]
```

## Pré-requisitos
- **Node.js** v16 ou superior (recomendado v18+).
- **NPM** (ou Yarn).

## Instalação

1. Na raiz do projeto, instale as dependências:
   ```bash
   npm install
   ```

## Execução

1. Garanta que o arquivo `ifood_urls_padrao_item_1000.csv` está na mesma pasta.
2. Rode o comando de inicialização:
   ```bash
   node scraper.js
   ```
3. O console exibirá o andamento (Ex: `[15/1000] (1.5%) SUCESSO...`).
4. Ao final, confira o `produtos_extraidos.json` para os dados, e a pasta `evidences/` para os prints.
