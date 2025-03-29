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

## Setup

1. Clone this repository:
   ```
   git clone https://github.com/yourusername/Airia-Powered-Slackbot.git
   cd Airia-Powered-Slackbot
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Configure your secrets (NEVER commit these to the repository):
   ```
   wrangler secret put Airia_API_key
   wrangler secret put Slack_Signing_Secret
   wrangler secret put Slack_Bot_Token
   ```

4. Update the `AIRIA_API_URL` in `wrangler.toml` with your Airia API endpoint

5. Create your Slack app in the [Slack API portal](https://api.slack.com/apps):
   - Enable slash commands
   - Enable bot token scopes for messaging
   - Add OAuth permissions for `chat:write`, `im:history`, and `app_mentions:read`
   - Configure the bot's home tab
   - Set up event subscriptions for messages and app_home_opened events

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