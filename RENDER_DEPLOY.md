# Render deploy notes

Use these settings when creating the Render service.

## Service type

Web Service

## Runtime

Node

## Build command

Leave blank, or use:

```sh
npm install
```

The app currently has no external dependencies, so a build step is not required.

## Start command

```sh
npm start
```

## Health check path

```txt
/health
```

## Important

If your GitHub repository contains the whole doorbell project folder, set Render's root directory to:

```txt
1.2 doorbell-mvp live
```

If your GitHub repository contains only the `1.2 doorbell-mvp live` folder contents, leave the root directory blank.
