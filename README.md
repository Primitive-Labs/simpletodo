# Primitive Template App

A production-ready Vue application template built with TypeScript, Vite, and the `primitive-app` framework.

## Documentation

For guides and API reference docs, see **Primitive Docs**: https://primitive-labs.github.io/primitive-docs/

## Quick Start

### 1. Create a New Repository from Template

Navigate to this [template repository](https://github.com/Primitive-Labs/primitive-app-template) on Github and click the **"Use this template"** green button in the upper right. This will copy all the files to a new repository for your project.

### 2. Install pnpm

This project uses [pnpm](https://pnpm.io/) as its package manager. The easiest way to install pnpm is using [Corepack](https://nodejs.org/api/corepack.html), which is included with Node.js 16+:

```bash
corepack enable
corepack prepare pnpm@latest --activate
```

If you prefer, you can also install pnpm using other methods described in the [pnpm installation guide](https://pnpm.io/installation).

### 3. Install the Primitive CLI

The `primitive-admin` CLI tool provides command-line access to the Primitive Admin server for managing your app. Install it globally:

```bash
npm install -g primitive-admin
```

Once installed, authenticate with your Primitive account:

```bash
primitive login
```

This will open a browser window for you to sign in. After signing in, you can verify your authentication:

```bash
primitive whoami
```

### 4. Clone Your New Repository

```bash
git clone https://github.com/your-username/my-new-app.git
cd my-new-app
```

### 5. Install Dependencies

```bash
pnpm install
```

### 6. Create a Primitive App

You need to create an app in the Primitive Admin system to get an **App ID** for your project.

**Option A: Using the CLI**

```bash
primitive apps create "My New App"
```

This will output your new **App ID**. You can also list your apps at any time:

```bash
primitive apps list
```

**Option B: Using the Dashboard**

Go to the [Primitive Admin console](https://admin.primitiveapi.com/login) and create a new app through the web interface.

Make note of your **App ID** for the next step.

### 7. Configure Environment

Edit `.env` and update the `VITE_APP_ID` to match the **App ID** you created in step 6.

### 8. Start Developing!

You can start the dev server with

```bash
pnpm dev
```

Visit `http://localhost:5173` to see your app running.

## Setting Up Google Sign In

Google OAuth is optional. If you want to enable Google as a sign-in option for your app, follow these steps:

### 1. Configure Google OAuth Client

Go to the [Google Cloud Console OAuth page](https://console.cloud.google.com/auth/clients) and configure a new OAuth client:

- **Authorized JavaScript origins**: By default, `http://localhost:5173` (add your production domain as well)
- **Authorized redirect URIs**: By default, `http://localhost:5173/oauth/callback` (add your production callback URL as well)

Make note of your **Client ID** and **Client Secret**.

### 2. Enable Google OAuth in Primitive Admin

Go to the [Primitive Admin console](https://admin.primitiveapi.com/login) and navigate to your app's settings:

1. Open the **Google OAuth** section
2. Enable Google OAuth as a sign-in method
3. Add your **Google Client ID** and **Client Secret** from step 1
4. Add matching origin/callback URLs to match what you configured with Google

## Deploying to Production

This project deploys to Cloudflare Workers. The configuration pattern is consistent with development: edit `.env` files for app settings.

### 1. Prerequisites

- **Cloudflare account** with access to deploy Workers
- **Wrangler CLI** - already included as a dev dependency

### 2. Configure wrangler.toml

Edit `wrangler.toml` to set your worker name:

```toml
name = "my-app"

[env.production]
name = "my-app-prod"
```

By default, your app will be deployed to a `*.workers.dev` URL. To use a custom domain, uncomment and edit the routes section:

```toml
[[env.production.routes]]
pattern = "your-domain.com"
custom_domain = true
```

### 3. Configure .env.production

Edit `.env.production` with your production settings:

```bash
# Your Primitive App ID (can be the same as development or a separate production app)
VITE_APP_ID=your_production_app_id

# OAuth redirect URI for your production domain
VITE_OAUTH_REDIRECT_URI=https://my-app-prod.your-subdomain.workers.dev/oauth/callback
```

### 4. Configure Production URL in Primitive Admin

Before deploying, make sure your app is configured with the production deployment URL in the [Primitive Admin console](https://admin.primitiveapi.com/login):

1. Navigate to your app's settings
2. Add your production URL (e.g., `https://my-app-prod.your-subdomain.workers.dev` or your custom domain) to the allowed origins
3. If using Google OAuth, also update the OAuth callback URL to match your production domain

### 5. Deploy

```bash
pnpm cf-deploy production
```

The deploy script reads `.env.production`, builds the project, and deploys to Cloudflare Workers.

To pass additional flags to wrangler, use `--` followed by the flags:

```bash
pnpm cf-deploy production -- --dry-run
```

## Adding More Environments

You can add additional environments (e.g., test, staging) by:

1. **Adding a section to wrangler.toml:**

```toml
[env.test]
name = "my-app-test"

[env.test.vars]
REFRESH_PROXY_COOKIE_MAX_AGE = "604800"
REFRESH_PROXY_COOKIE_PATH = "/proxy/"
```

2. **Creating a corresponding .env file** (e.g., `.env.test`)

3. **Deploying:**

```bash
pnpm cf-deploy test
```

The deploy script reads from `.env.{environment}` and uses `[env.{environment}]` from wrangler.toml.
