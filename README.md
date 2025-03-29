# Airia-Powered Slackbot

A Cloudflare Worker that connects Slack to the Airia API, enabling your team to interact with Airia's capabilities directly from Slack.

## Overview

This project creates a Slack bot that allows users to send queries to Airia's API through multiple interaction methods:

### Basic Interactions
- Slash commands (`/ask-airia`)
- Direct messages 
- @mentions in channels

### Advanced Features
- Message actions (summarize threads)
- Global shortcuts (ask from anywhere)
- Workflow steps (generate responses in workflows)
- Link unfurling (rich previews for your domains)

The bot is built on Cloudflare Workers for serverless deployment and reliable performance.

### Slack App Manifest

This repository includes a complete [Slack App Manifest](./slack-app-manifest.json) that you can use to quickly configure your Slack app with all the required permissions and features.

## Security Notes

- **No hardcoded secrets**: All API keys, tokens, and signing secrets are configured as environment variables
- **Environment separation**: Development and production environments are kept separate
- **Slack request verification**: All requests from Slack are verified using Slack's signing secret
- **Minimal logging**: Production environments limit logging to prevent accidental secret exposure
- **Testing**: Test files use mock credentials only

## Prerequisites

- [Node.js](https://nodejs.org/) (v16 or newer)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) for Cloudflare Workers
- A Cloudflare account
- A Slack workspace with permission to add apps
- Access to Airia API services

## Setup (Command Line)

This guide will walk you through deploying the Airia Slackbot to Cloudflare Workers from your command line.

### 1. Clone and Prepare Repository

```bash
# Clone the repository
git clone https://github.com/yourusername/Airia-Powered-Slackbot.git
cd Airia-Powered-Slackbot

# Install dependencies
npm install
```

### 2. Set Up Cloudflare Worker

#### If you don't have wrangler installed:

This guide uses `npx wrangler` to run wrangler commands without requiring a global installation.

#### If you already have wrangler installed globally:

```bash
# Check your wrangler version
wrangler --version

# If you see "update available" message, update to latest v4.x version
npm install -g wrangler@4
```

#### If you have a local installation:

```bash
# Check current wrangler version
npx wrangler --version

# If you see "update available" message, update to latest v4.x version 
npm install --save-dev wrangler@4
```

#### Continue with setup:

```bash
# Log in to Cloudflare (will open browser for authentication)
npx wrangler login

# Create a new Cloudflare Worker (using npx)
npx wrangler init
```

When prompted during `wrangler init`:
- Select "Deploy an existing application" when asked about the Worker type
- Select "No" for starting with a starter template
- Select "Yes" for typechecking with TypeScript
- Select "No" for using git for version control (since you already cloned the repo)

### 3. Configure Worker Name

Edit the `wrangler.toml` file:

```bash
# On macOS/Linux
sed -i '' 's/name = ".*"/name = "airia-slackbot"/' wrangler.toml

# Or edit manually - change the name line to:
# name = "airia-slackbot"
```

### 4. Configure Environment Variables

Edit your API URLs in the `wrangler.toml` file:

```bash
# For development environment
sed -i '' 's/YOUR_DEV_API_URL/https:\/\/dev-api.example.com\/airia/' wrangler.toml

# For production environment
sed -i '' 's/YOUR_PRODUCTION_API_URL/https:\/\/api.example.com\/airia/' wrangler.toml

# Or edit manually in your text editor
```

### 5. Add Secrets

```bash
# Development environment secrets
npx wrangler secret put Airia_API_key
# When prompted, enter your Airia API key

npx wrangler secret put Slack_Signing_Secret
# When prompted, enter your Slack Signing Secret

npx wrangler secret put Slack_Bot_Token
# When prompted, enter your Slack Bot Token

# Production environment secrets
npx wrangler secret put Airia_API_key --env production
npx wrangler secret put Slack_Signing_Secret --env production
npx wrangler secret put Slack_Bot_Token --env production
```

### 6. Deploy Worker

```bash
# Deploy to development environment
npx wrangler deploy

# Deploy to production environment
npx wrangler deploy --env production
```

### 7. Set Up Slack App

After deploying your worker, you'll need to configure a Slack app to connect to it:

```bash
# Get your Worker URL (note this for the next steps)
npx wrangler whoami
echo "Your worker is deployed at: https://airia-slackbot.YOUR_SUBDOMAIN.workers.dev"
```

#### 7.1 Create Slack App

```bash
# Open Slack API portal (will open in browser)
open https://api.slack.com/apps
# Or access https://api.slack.com/apps manually
```

#### App Manifest Limitations

The Slack App Manifest system has limitations with URL-dependent features. This is by design for security reasons:

1. **Security restrictions:** Slack prevents specifying URLs in the initial manifest to protect against malicious manifests that might send data to unauthorized endpoints.

2. **Verification requirement:** Slack requires that all URLs be verified as belonging to you. This verification happens after app creation when you manually enter the URLs.

3. **URL-dependent features that require manual setup:**
   - Slash commands
   - Interactive component request URLs
   - Event subscription request URLs
   - Workflow steps
   - Message actions

According to [Slack's documentation](https://api.slack.com/reference/manifests), the manifest can only set up permissions, scopes, and basic app configuration.

For a quick setup that still requires some manual steps:

1. Visit [https://api.slack.com/apps](https://api.slack.com/apps)
2. Click "Create New App"
3. Select "From an app manifest"
4. Choose your workspace
5. Copy and paste the contents of [slack-app-manifest.json](./slack-app-manifest.json)
6. Click "Create"

7. **Required Post-Creation Setup:**
   After the app is created, you must configure all URL-dependent features:

   - **Slash Commands:**
     - Click "Slash Commands" in the sidebar
     - Click "Create New Command"
     - Command: `/ask-airia`
     - Request URL: `https://your-worker.workers.dev/slack`
     - Description: "Ask Airia a question"
     - Click "Save"

   - **Event Subscriptions:**
     - Click "Event Subscriptions" in the sidebar
     - Toggle "Enable Events" to On
     - Request URL: `https://your-worker.workers.dev/slack`
     - The bot events should already be subscribed (app_home_opened, app_mention, message.im, link_shared)
     - Under "App unfurl domains", add yourdomain.com (if using link unfurling)
     - Click "Save Changes"

   - **Interactivity & Shortcuts:**
     - Click "Interactivity & Shortcuts" in the sidebar
     - Toggle to On
     - Request URL: `https://your-worker.workers.dev/slack`
     - Add shortcuts, message actions, and workflow steps (see manual setup instructions below)
     - Click "Save Changes"

#### Manual Setup

If you prefer to configure manually:

In the browser:
1. Click "Create New App"
2. Choose "From scratch"
3. Enter "AI Assistant" for name, select your workspace, and click "Create App"

#### 7.2 Configure App Features

In the Slack App settings:

**Basic Information:**
- Note your "Signing Secret" (needed for the `Slack_Signing_Secret` you configured earlier)

**App Home:**
- Under "Show Tabs", enable "Home Tab"
- Enable "Allow users to send Slash commands and messages from the messages tab"

**Slash Commands:**
1. Click "Create New Command"
2. Command: `/ask-airia`
3. Request URL: `https://airia-slackbot.YOUR_SUBDOMAIN.workers.dev/slack`
4. Short Description: "Ask a question to Airia"
5. Click "Save"

**OAuth & Permissions:**
1. Under "Scopes", add these Bot Token Scopes:
   - `app_mentions:read`
   - `chat:write`
   - `im:history`
   - `im:write`
2. Under "OAuth Tokens for Your Workspace", click "Install to Workspace"
3. Note your "Bot User OAuth Token" (needed for the `Slack_Bot_Token` you configured earlier)

**Event Subscriptions:**
1. Enable Events: Toggle "On"
2. Request URL: `https://airia-slackbot.YOUR_SUBDOMAIN.workers.dev/slack`
3. Under "Subscribe to bot events", add:
   - `app_home_opened`
   - `app_mention`
   - `message.im`
   - `link_shared` (for link unfurling)
4. Under "App unfurl domains", add your domain (e.g., yourdomain.com)
5. Click "Save Changes"

**Interactivity & Shortcuts:**
1. Enable Interactivity: Toggle "On"
2. Request URL: `https://airia-slackbot.YOUR_SUBDOMAIN.workers.dev/slack`
3. Under "Shortcuts", click "Create New Shortcut"
4. Create a Global shortcut:
   - Name: "Ask Airia"
   - Short Description: "Ask Airia a question from anywhere"
   - Callback ID: `ask_airia_shortcut`
5. Under "Message Menus", click "Create New Message Action"
   - Name: "Summarize Thread"
   - Description: "Get Airia to summarize this thread"
   - Callback ID: `summarize_thread`
6. Click "Save Changes"

**Workflow Steps:**
1. Go to "Workflow Steps" in sidebar
2. Click "Add Step"
3. Name: "Generate response"
4. Callback ID: `generate_response`
5. Click "Save"

#### 7.3 Verify Configuration

If you haven't already added the Slack secrets, add them now:

```bash
# Add/update the Slack secrets with values from the Slack app configuration
npx wrangler secret put Slack_Signing_Secret
# Enter the signing secret from Basic Information

npx wrangler secret put Slack_Bot_Token
# Enter the Bot User OAuth Token from OAuth & Permissions
```

#### 7.4 Testing Your Deployment

**Development Environment Testing:**

The development deployment includes a `/test` endpoint for basic verification:
```bash
# Test the development deployment's test endpoint
curl https://airia-slackbot.YOUR_SUBDOMAIN.workers.dev/test
# Should return: {"status":"ok","environment":"development"}
```

**Production Environment Testing:**

The production deployment has the `/test` endpoint disabled for security:
```bash
# This should return a 404 in production
curl https://airia-slackbot.YOUR_SUBDOMAIN.workers.dev/test
# Should return: Not found
```

**Slack Integration Testing:**

Test all Slack integration features:

*Basic Features:*
1. In Slack, type `/ask-airia test message` in any channel
2. Send a direct message to your AI Assistant
3. Mention the bot with `@AI Assistant test message` in a channel

*Advanced Features:*
4. Start a thread in a channel, then click the three dots menu (⋮) and select "Summarize Thread"
5. Use the lightning bolt (⚡) icon in the message compose box and select "Ask AI Assistant"
6. In Slack Workflow Builder, create a new workflow and add the "Generate response" step
7. Share a link from your configured domain to see link unfurling

## Development and Production Environments

This project supports multiple environments to separate development and production configurations.

> **Note**: This project includes wrangler as a dev dependency in package.json, so you don't need to install it globally. The npm scripts (`npm run dev`, `npm run deploy`) will use the local version. However, this project may have an older version - check with `npx wrangler --version` and if it shows "update available," run `npm install --save-dev wrangler@4` to update to the latest v4.x version.

### Local Development

Start a local development server:
```bash
# This runs npx wrangler dev under the hood (defined in package.json)
npm run dev

# Or you can run it directly with npx
npx wrangler dev
```

This uses the default environment configured in `wrangler.toml` with:
- `ENVIRONMENT = "development"` variable
- Development-friendly logging
- Enabled `/test` endpoint for health checking
- More verbose logging of environment variables

### Testing with Cloudflare Tunnel

To receive Slack events during local development, use Cloudflare Tunnel:

1. Install the Cloudflare Tunnel client:
   ```
   npm install -g cloudflared
   ```

2. Start a tunnel to your local development server:
   ```
   cloudflared tunnel --url http://localhost:8787
   ```

3. Use the temporary URL provided by Cloudflare Tunnel as your Slack bot's request URL

### Environment-specific Development

To test with specific environment configurations:
```bash
# Development environment
npx wrangler dev --env development

# Production environment
npx wrangler dev --env production
```

### Deployment

#### Deploy to Development

```
wrangler deploy
```

This deploys using the default environment in `wrangler.toml`.

#### Deploy to Production

```
wrangler deploy --env production
```

This uses the production-specific configuration in `wrangler.toml` with:
- `ENVIRONMENT = "production"` variable 
- Disabled `/test` endpoint for security (returns 404)
- Minimal logging (no sensitive data, even partially)
- No environment variable logging
- Production-appropriate security settings

### Environment Configuration

Edit the `wrangler.toml` file to configure environments:

```toml
# Default (development) environment
[vars]
AIRIA_API_URL = "YOUR_DEV_API_URL"
ENVIRONMENT = "development"

# Development-specific configuration
[env.development]
vars = { ENVIRONMENT = "development", AIRIA_API_URL = "YOUR_DEV_API_URL" }

# Production environment
[env.production]
vars = { ENVIRONMENT = "production", AIRIA_API_URL = "YOUR_PRODUCTION_API_URL" }
```

> **Note**: With wrangler 4.x and newer, inline tables must be on a single line

Remember to set environment-specific secrets:
```
# Development secrets
wrangler secret put Airia_API_key

# Production secrets
wrangler secret put Airia_API_key --env production
```

## Slack Commands

Once deployed, users can interact with the bot in the following ways:

- **Slash Command**: Use `/ask-airia [question]` in any channel to ask Airia a question
- **Direct Message**: Send a direct message to the bot with your query
- **@mention**: Mention the bot in any channel using `@Ask Airia [question]`

## Testing

Run tests:
```
npm test
```

## Project Structure

- `src/index.js` - Main worker code that handles Slack requests and communicates with Airia
- `wrangler.toml` - Cloudflare Worker configuration
- `test/` - Test files for the worker
- `slack-app-manifest.json` - Complete Slack app configuration manifest for easy setup

## Security Best Practices

1. **Never commit secrets** to your repository
2. Use Cloudflare Worker secrets for sensitive values
3. Always verify Slack request signatures
4. Set up proper timeouts for all API requests
5. Implement environment-specific logging levels
6. Regularly rotate your API keys and tokens

## License

[Insert your license information here]

## Contributing

[Insert contribution guidelines here]

## Troubleshooting

### Common Issues

#### "Unterminated inline array" in wrangler.toml

```
✘ [ERROR] Unterminated inline array
    /path/to/wrangler.toml:XX:XX:
      XX │ vars = { 
         ╵         ^
```

**Solution**: Wrangler 4.x requires inline tables to be on a single line. Update your environment variables section:

```toml
# Incorrect format (will cause error in wrangler 4.x)
[env.development]
vars = { 
  ENVIRONMENT = "development",
  AIRIA_API_URL = "YOUR_DEV_API_URL" 
}

# Correct format
[env.development]
vars = { ENVIRONMENT = "development", AIRIA_API_URL = "YOUR_DEV_API_URL" }
```

## Support

For issues with this bot, please open an issue in this repository.
For issues with the Airia API, contact your Airia administrator.