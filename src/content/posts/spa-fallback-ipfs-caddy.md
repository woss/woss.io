---
title: 'How to serve SPA with fallback on IPFS'
slug: 'spa-fallback-ipfs-caddy'
date: 2024-06-01
tags:
  - caddy
  - ipfs
  - spa
  - reverse proxy
  - routing
excerpt: 'How to serve SPA with fallback on IPFS Firstly we need to understand that the non file system routing ( prerendered pages and index.html ) will always fail when served from IPFS and this is because the IPFS is not aware of it. Here is the simple and working example how to serve SPA with index.html as a fallback using Caddy server.'
description: 'Configure Caddy server as a reverse proxy for IPFS to serve SPAs with index.html fallback'
published: true
---

Firstly we need to understand that the non file system routing ( prerendered pages and index.html ) will always fail when served from
IPFS and this is because the IPFS is not aware of it. Here is the simple and working example how to serve SPA with `index.html` as a fallback using Caddy server.

```caddy
# General purpose ipfs gateway for Macula nodes;
*.g.macula.link {
  encode gzip
  # rewrite the main request
  rewrite * /ipfs/{labels.3}{uri}

  reverse_proxy {
    # proxy all to the IPFS gateway
    to http://127.0.0.1:8080

    # catch 404, this will happen when reloading page that has memory router and the path doesn't
    # exist on the IPFS
    @not_found status 404
    handle_response @not_found {
    # remove the {uri} because that is the error
    rewrite * /ipfs/{labels.3}/index.html
      reverse_proxy http://127.0.0.1:8080
    }
  }

  log {
  output file ./logs/g.log
  level DEBUG
  }
}
```

In order to test this, you need to have SPA that has internal routing, most of the routing in react is done like that, also Sveltekit has it with following settings:

```js
// routes/layout.ts
export const ssr = false;
export const prerender = false;

// svelte.config.js
import adapterStatic from '@sveltejs/adapter-static';
config.kit.adapter = adapterStatic({
  fallback: 'index.html',
});
```
