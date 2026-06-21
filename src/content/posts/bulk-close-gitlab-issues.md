---
title: 'How to close all gitlab issues for a project in bulk'
slug: 'bulk-close-gitlab-issues'
date: 2021-12-15
tags:
  - gitlab
  - automation
  - scripting
  - project management
excerpt: 'How to close all gitlab issues for a project in bulk Make a folder called closeAllIssues then copy this and save it to the file named closeAllIssues.js'
description: 'Script to bulk close all open GitLab issues for a project using the GitLab API'
published: true
---

# How to close all gitlab issues for a project in bulk

Make a folder called `closeAllIssues` then copy this and save it to the file named `closeAllIssues.js`

```js
#!/usr/bin/env node
const axios = require('axios').default;

const personAccessToken = 'you-access-token';
const projectId = 'HERE_BE_YOUR_PROJECT_ID';
const gitlabHost = 'https://gitlab.com';
const apiPath = `api/v4/projects/${projectId}`;
const url = `${gitlabHost}/${apiPath}/issues?private_token=${personAccessToken}&per_page=100&state=opened`;

axios
  .get(url)
  .then((response) => {
    const issues = response.data;
    issues.forEach((issue) => {
      console.log(`Closing issue with ID ${issue.iid}`);
      const closingUrl = `${gitlabHost}/${apiPath}/issues/${issue.iid}?state_event=close`;
      axios
        .put(
          closingUrl,
          {},
          {
            headers: {
              'PRIVATE-TOKEN': personAccessToken,
            },
          },
        )
        .then((r) => {
          console.log(`Issue ${r.data.iid} closed`);
        })
        .catch((e) => console.error(e.data));
    });
  })
  .catch((e) => console.error(e.data));
```

Replace the _personAccessToken_ and _projectId_ with correct values.

install the axios by running `yarn add axios`

then you can run the script

```sh
node closeAllIssues.js
```
