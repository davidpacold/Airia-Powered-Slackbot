# Airia-Powered Slackbot

A Cloudflare Worker that connects Slack to the Airia API, enabling your team to interact with Airia's capabilities directly from Slack.

## Overview

This project creates a Slack bot that allows users to send queries to Airia's API through:
- Slash commands (`/ask-airia`)
- Direct messages 
- @mentions in channels

The bot is built on Cloudflare Workers for serverless deployment and reliable performance.

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

```bash
# Install Wrangler CLI if you don't have it
npm install -g wrangler

# Log in to Cloudflare (will open browser for authentication)
wrangler login

# Create a new Cloudflare Worker
wrangler init
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
wrangler secret put Airia_API_key
# When prompted, enter your Airia API key

wrangler secret put Slack_Signing_Secret
# When prompted, enter your Slack Signing Secret

wrangler secret put Slack_Bot_Token
# When prompted, enter your Slack Bot Token

# Production environment secrets
wrangler secret put Airia_API_key --env production
wrangler secret put Slack_Signing_Secret --env production
wrangler secret put Slack_Bot_Token --env production
```

### 6. Deploy Worker

```bash
# Deploy to development environment
wrangler deploy

# Deploy to production environment
wrangler deploy --env production
```

### 7. Set Up Slack App

After deploying your worker, you'll need to configure a Slack app to connect to it:

```bash
# Get your Worker URL (note this for the next steps)
wrangler whoami
echo "Your worker is deployed at: https://airia-slackbot.YOUR_SUBDOMAIN.workers.dev"
```

#### 7.1 Create Slack App

```bash
# Open Slack API portal (will open in browser)
open https://api.slack.com/apps
# Or access https://api.slack.com/apps manually
```

In the browser:
1. Click "Create New App"
2. Choose "From scratch"
3. Enter "Airia Bot" for name, select your workspace, and click "Create App"

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
4. Click "Save Changes"

#### 7.3 Verify Configuration

If you haven't already added the Slack secrets, add them now:

```bash
# Add/update the Slack secrets with values from the Slack app configuration
wrangler secret put Slack_Signing_Secret
# Enter the signing secret from Basic Information

wrangler secret put Slack_Bot_Token
# Enter the Bot User OAuth Token from OAuth & Permissions
```

Now test the Slack integration:
1. In Slack, type `/ask-airia test message` in any channel
2. Send a direct message to your Airia bot
3. Mention the bot with `@Airia Bot test message` in a channel

## Development and Production Environments

This project supports multiple environments to separate development and production configurations.

### Local Development

Start a local development server:
```
npm run dev
```

This uses the default environment configured in `wrangler.toml` with:
- `ENVIRONMENT = "development"` variable
- Development-friendly logging
- Enabled test endpoints

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
```
# Development environment
wrangler dev --env development

# Production environment
wrangler dev --env production
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
- Disabled debugging endpoints
- Minimal logging
- Production-appropriate security settings

### Environment Configuration

Edit the `wrangler.toml` file to configure environments:

```toml
# Default (development) environment
[vars]
AIRIA_API_URL = "YOUR_DEV_API_URL"
ENVIRONMENT = "development"

# Production environment
[env.production]
vars = { 
  AIRIA_API_URL = "YOUR_PRODUCTION_API_URL",
  ENVIRONMENT = "production" 
}
```

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

## Support

For issues with this bot, please open an issue in this repository.
For issues with the Airia API, contact your Airia administrator.