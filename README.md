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

### Key Features

- **Robust Thread Handling**: Multi-layered approach to thread detection with multiple fallbacks
- **Message Context**: Summarizes messages with surrounding conversation for better context
- **User Resolution**: Resolves Slack user IDs to real names for more readable summaries
- **Detailed Diagnostics**: Optional verbose logging for troubleshooting and development
- **Environment Separation**: Clear separation between development and production environments

### Expected Airia API Format

This integration expects the Airia API to return responses in the following JSON format:

```json
{
  "result": "The text response from Airia",
  "isBackupPipeline": false
}
```

If your API uses a different format, you'll need to modify the response handling in the source code.

### Slack App Manifest

This repository includes a [Slack App Manifest](./slack-app-manifest.json) that you can use to quickly configure your Slack app with the required permissions. Note that URL configurations must be added manually after app creation due to Slack's security requirements.

## Security Notes

- **No hardcoded secrets**: All API keys, tokens, and signing secrets are configured as environment variables
- **Environment separation**: Development and production environments are kept separate
- **Slack request verification**: All requests from Slack are verified using Slack's signing secret
- **Minimal logging**: Production environments limit logging to prevent accidental secret exposure
- **Testing**: Test files use mock credentials only

## Prerequisites

For the deployment process, you'll need:

- [Node.js](https://nodejs.org/) (v16 or newer) installed on your computer
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) for Cloudflare Workers (installed automatically by the setup process)
- A Cloudflare account (free tier is sufficient)
- A Slack workspace where you have permission to add apps
- Access to Airia API services, including:
  - Airia API endpoint URL
  - Airia API key

For non-technical users: You may need to coordinate with your IT team to:
1. Create a Cloudflare account if you don't have one
2. Get access to your Airia API credentials
3. Get Slack admin permissions if you don't already have them

## Setup

This guide will walk you through deploying the Airia Slackbot to Cloudflare Workers. There are two main parts to the setup:

1. Deploying the Cloudflare Worker (the code that connects to Airia)
2. Setting up the Slack App (the interface users will interact with)

For non-technical users, we recommend asking a developer to help with the deployment. Once deployed, the bot is very easy to use.

### 1. Clone and Prepare Repository

```bash
# Clone the repository
git clone https://github.com/yourusername/Airia-Powered-Slackbot.git
cd Airia-Powered-Slackbot

# Install dependencies
npm install
```

### 2. Set Up Cloudflare Worker

#### If you don't have  installed:

This guide uses `npx ` to run  commands without requiring a global installation.

#### If you already have  installed globally:

```bash
# Check your  version
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

#### Continue with Cloudflare setup:

```bash
# Log in to Cloudflare (will open browser for authentication)
npx wrangler login
```

Since this is an existing project, there's no need to run `wrangler init` - the project is already initialized with all the necessary files. You can proceed to configuring and deploying.

### 3. Configure Worker Name (Optional)

If you want to change the default Worker name, edit the `wrangler.toml` file:

```bash
# On macOS/Linux
sed -i '' 's/name = ".*"/name = "airia-slackbot"/' wrangler.toml

# Or edit manually - change the name line to:
# name = "airia-slackbot"
```

Note: Changing the name is optional. The default name in the repository is `github-airia-slackbot`, but you can customize it to whatever you prefer.

### 4. Configure Environment Variables

Update the Airia API URLs in the `wrangler.toml` file to point to your specific Airia endpoints:

```bash
# Edit manually in your text editor, replacing the existing URLs with your actual API endpoints
# For example, change:
# AIRIA_API_URL = "https://api.airia.ai/v1/PipelineExecution/fd16c532-6895-480a-bd4e-b08745b5aa54"
# to your specific endpoint
```

The current wrangler.toml already contains placeholder Airia API URLs. You should replace these with your actual API endpoints for both development and production environments.

### 5. Prepare for Required Secrets

#### Where to Find Each Secret

Before you deploy, you'll need these secrets. Here's where to find them:

- **Airia_API_key**: 
  - This is your API key for the Airia service
  - Obtain this from your Airia administrator or dashboard
  - If using another AI service, use their API key

- **Slack_Signing_Secret**:
  - Located in your Slack App settings under "Basic Information" 
  - Look for "Signing Secret" in the "App Credentials" section
  - ![Signing Secret Location](https://api.slack.com/img/api/app_credentials.png)

- **Slack_Bot_Token**:
  - Located in your Slack App settings under "OAuth & Permissions"
  - Look for "Bot User OAuth Token" that starts with `xoxb-`
  - You must install the app to your workspace first to get this token

> **Note**: We will configure these secrets after setting up the Slack app in step 7.3. 
> The signature verification in the code will be skipped if `Slack_Signing_Secret` isn't set yet. 
> This helps during initial setup/verification of your Slack endpoints. Once you have your app 
> fully configured, make sure to set this secret for secure operation.

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
# Get your Worker URL (if needed)
npx wrangler whoami
```

The deployment output from the previous step will have shown your Worker URL.
Copy this URL - you'll need it for configuring your Slack app endpoints.
The URL will typically look like: `https://github-airia-slackbot.your-subdomain.workers.dev`

#### 7.1 Create Slack App

```bash
# Open Slack API portal (will open in browser)
open https://api.slack.com/apps
# Or access https://api.slack.com/apps manually
```

#### Understanding the App Manifest

The provided Slack App manifest **only includes**:
- Basic app information (name, description, color)
- Bot user configuration
- App Home tab settings
- Required OAuth scopes/permissions

The manifest **deliberately excludes** any URL-dependent features due to Slack's security restrictions. Slack will not allow an app manifest to include request URLs during initial creation.

**Why this limitation exists:**
- Security: Prevents malicious manifests from sending data to unauthorized endpoints
- Verification: Slack requires that all URLs be verified during app setup

**Features you must configure manually after app creation:**
- Event Subscriptions (with your Worker URL)
- Slash Commands (with your Worker URL)
- Interactivity settings (with your Worker URL)
- Message Actions
- Shortcuts
- Workflow Steps

For more details, see [Slack's documentation on manifests](https://api.slack.com/reference/manifests).

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
     - Request URL: `https://github-airia-slackbot.your-subdomain.workers.dev/slack` (for development) or `https://github-airia-slackbot-production.your-subdomain.workers.dev/slack` (for production)
     - Description: "Ask Airia a question"
     - Click "Save"

   - **Event Subscriptions:**
     - Click "Event Subscriptions" in the sidebar
     - Toggle "Enable Events" to On
     - Request URL: `https://github-airia-slackbot.your-subdomain.workers.dev/slack` (for development) or `https://github-airia-slackbot-production.your-subdomain.workers.dev/slack` (for production)
     - The bot events should already be subscribed (app_home_opened, app_mention, message.im, link_shared)
     - Under "App unfurl domains", add yourdomain.com (if using link unfurling)
     - Click "Save Changes"

   - **Interactivity & Shortcuts:**
     - Click "Interactivity & Shortcuts" in the sidebar
     - Toggle to On
     - Request URL: `https://github-airia-slackbot.your-subdomain.workers.dev/slack` (for development) or `https://github-airia-slackbot-production.your-subdomain.workers.dev/slack` (for production)
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
3. Request URL: `https://github-airia-slackbot.your-subdomain.workers.dev/slack` (for development) or `https://github-airia-slackbot-production.your-subdomain.workers.dev/slack` (for production)
4. Short Description: "Ask a question to Airia"
5. Click "Save"

**OAuth & Permissions:**
1. Under "Scopes", add these Bot Token Scopes:
   
   *Basic functionality:*
   - `app_mentions:read` - Allows the bot to see when it's mentioned
   - `chat:write` - Allows the bot to send messages
   - `im:history` - Allows the bot to read direct messages
   - `im:write` - Allows the bot to send direct messages
   
   *Enhanced functionality (recommended):*
   - `channels:history` - Allows the bot to read channel messages
   - `channels:join` - Allows the bot to join public channels
   - `channels:read` - Allows the bot to see channel information 
   - `chat:write.public` - Allows the bot to write in public channels it's not a member of
   - `commands` - Allows the bot to use slash commands
   - `groups:history` - Allows the bot to read private channel messages
   - `groups:read` - Allows the bot to see private channel information
   - `links:read` - Allows the bot to unfurl links
   - `mpim:history` - Allows the bot to read group DM messages
   - `mpim:read` - Allows the bot to see group DM information
   - `mpim:write` - Allows the bot to send messages in group DMs
   - `reactions:read` - Allows the bot to see reactions
   - `users:read` - Allows the bot to see user information
   - `workflow.steps:execute` - Allows the bot to run workflow steps
2. Under "OAuth Tokens for Your Workspace", click "Install to Workspace"
3. Note your "Bot User OAuth Token" (needed for the `Slack_Bot_Token` you configured earlier)

**Event Subscriptions:**
1. Enable Events: Toggle "On"
2. Request URL: `https://github-airia-slackbot.your-subdomain.workers.dev/slack` (for development) or `https://github-airia-slackbot-production.your-subdomain.workers.dev/slack` (for production)
3. Under "Subscribe to bot events", add:
   - `app_home_opened`
   - `app_mention`
   - `message.im`
   - `link_shared` (for link unfurling)
4. Under "App unfurl domains", add your domain (e.g., yourdomain.com)
5. Click "Save Changes"

**Interactivity & Shortcuts:**
1. Enable Interactivity: Toggle "On"
2. Request URL: `https://github-airia-slackbot.your-subdomain.workers.dev/slack` (for development) or `https://github-airia-slackbot-production.your-subdomain.workers.dev/slack` (for production)
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

#### 7.3 Configure Secrets for Both Environments

You need to configure the required secrets for both development and production environments:

```bash
# Development environment secrets
npx wrangler secret put Slack_Signing_Secret
# Enter the signing secret from Basic Information > App Credentials

npx wrangler secret put Slack_Bot_Token
# Enter the Bot User OAuth Token from OAuth & Permissions

npx wrangler secret put Airia_API_key
# Enter your Airia API key

# Production environment secrets
npx wrangler secret put Slack_Signing_Secret --env production
# Enter the same signing secret (or a different one if using separate Slack apps)

npx wrangler secret put Slack_Bot_Token --env production
# Enter the same Bot User OAuth Token (or a different one if using separate Slack apps)

npx wrangler secret put Airia_API_key --env production
# Enter your production Airia API key (may be the same as development)
```

> **Important**: Make sure to set secrets for both environments before deployment to ensure everything works correctly. If you're using the same Slack app for both environments, the Slack secrets will be identical, but you might use different Airia API keys.

#### 7.4 Testing Your Deployment

**Important Note on Deployment URLs:**

When deploying to different environments, the URLs will be different:

- Development URL: `https://github-airia-slackbot.your-subdomain.workers.dev`
- Production URL: `https://github-airia-slackbot-production.your-subdomain.workers.dev`

The production URL has `-production` appended to the worker name. This means you'll need to update your Slack app configuration when switching between environments.

**Development Environment Testing:**

The development deployment includes a `/test` endpoint for basic verification:
```bash
# Test the development deployment's test endpoint
curl https://github-airia-slackbot.your-subdomain.workers.dev/test
# Should return: {"status":"ok","environment":"development"}
```

**Production Environment Testing:**

The production deployment has the `/test` endpoint disabled for security:
```bash
# This should return a 404 in production
curl https://github-airia-slackbot-production.your-subdomain.workers.dev/test
# Should return: Not found
```

**Slack Integration Testing:**

Test all Slack integration features:

*Basic Features:*
1. In Slack, type `/ask-airia test message` in any channel
2. Send a direct message to your AI Assistant
3. Mention the bot with `@AI Assistant test message` in a channel

*Advanced Features:*
4. Click the three dots menu (⋮) on any message and select "Summarize" to:
   - Summarize a thread (if the message has replies) - summary appears in the thread itself
   - Summarize a single message (if it's not in a thread) - summary appears as a reply to the original message
   - Summarize recent conversation (for context) - summary appears as a new message in the channel
   *(Note: Make sure to add the bot to any channels where you want to use this feature)*
   
   The thread detection and reply behavior now includes:
   - Extremely robust thread detection with multiple fallback mechanisms
   - Smart handling of thread parents vs. thread replies
   - Timestamp validation and automatic cleaning of invalid formats
   - Automatic retry with alternate timestamps if the first attempt fails
   - Special handling for the "invalid_arguments" error that can occur with some thread formats
   - Clear explanatory messages if a thread reply has to fall back to a regular message
   - Detailed diagnostic logging to help troubleshoot edge cases
5. Use the lightning bolt (⚡) icon in the message compose box and select "Ask AI Assistant"
6. In Slack Workflow Builder, create a new workflow and add the "Generate response" step
7. Share a link from your configured domain to see link unfurling

> **Important**: For features that access channel messages (like thread summarization), 
> you must add the bot to those channels first. For private channels, manually
> add the bot using `/invite @AI Assistant`.
>
> If you see errors like `[THREAD_SUMMARY] Channel join attempt: Failed: missing_scope` in your logs, it means your bot needs to be reinstalled with additional permissions. In particular, the "Summarize Thread" feature requires the `channels:join` scope to work properly. Make sure you've included all the recommended scopes when creating your app, then reinstall it to your workspace.

## Development and Production Environments

This project supports multiple environments to separate development and production configurations.

> **Note**: This project includes wrangler as a dev dependency in package.json, so you don't need to install it globally. The npm scripts (`npm run dev`, `npm run deploy`) will use the local version. However, this project may have an older version - check with `npx wrangler --version` and if it shows "update available," run `npm install --save-dev wrangler@4` to update to the latest v4.x version.

### Environment Configuration

Edit the `wrangler.toml` file to configure environments:

```toml
# Default (development) environment
[vars]
AIRIA_API_URL = "YOUR_DEV_API_URL"
ENVIRONMENT = "development"
VERBOSE_LOGGING = "true"  # Set to "false" to disable verbose logging

# Development-specific configuration
[env.development]
vars = { ENVIRONMENT = "development", AIRIA_API_URL = "YOUR_DEV_API_URL", VERBOSE_LOGGING = "true" }

# Production environment
[env.production]
vars = { ENVIRONMENT = "production", AIRIA_API_URL = "YOUR_PRODUCTION_API_URL", VERBOSE_LOGGING = "false" }
```

> **Note**: With wrangler 4.x and newer, inline tables must be on a single line

Remember that each environment needs its own set of secrets as described in section 7.3:
```bash
# Development and production environments each need these secrets:
# - Airia_API_key
# - Slack_Signing_Secret
# - Slack_Bot_Token
```

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
- `VERBOSE_LOGGING = "true"` for detailed diagnostics
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
npx wrangler deploy
```

This deploys using the default environment in `wrangler.toml`, creating a URL like:
`https://github-airia-slackbot.your-subdomain.workers.dev`

#### Deploy to Production

```
npx wrangler deploy --env production
```

This creates a different URL with `-production` appended to the worker name:
`https://github-airia-slackbot-production.your-subdomain.workers.dev`

The production environment uses production-specific configuration in `wrangler.toml` with:
- `ENVIRONMENT = "production"` variable 
- `VERBOSE_LOGGING = "false"` to reduce log volume in production
- Disabled `/test` endpoint for security (returns 404)
- Minimal logging (no sensitive data, even partially)
- No environment variable logging
- Production-appropriate security settings

> **Important**: Since development and production deployments have different URLs, you'll need to reconfigure your Slack app's request URLs when switching between environments. This includes updating the request URLs for Events, Interactivity, Slash Commands, and other features in your Slack app settings.

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

## Support and Guarantees

This project is provided as-is, without any official support. While you are welcome to open issues in the repository, there is no guarantee of a response or resolution. The software is provided with no guarantees that it will work in the future, as it may be impacted by changes to the underlying APIs or platforms it relies on.



## Customizing for Different API Formats

If your Airia API (or any other AI API you're using) returns data in a format different from what's expected, you'll need to modify the response handling logic in the source code.

The code currently expects JSON responses in this format:
```json
{
  "result": "The text response from the AI",
  "isBackupPipeline": false
}
```

To adapt to a different API format:

1. Look for the AI API fetch calls in the code (in functions like `processSlashCommand`, `processDM`, etc.)
2. Modify the response parsing and how the data is displayed to users

Key files to edit:
- `src/index.js`: The main worker file that handles all API interactions

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
  AIRIA_API_URL = "YOUR_DEV_AIRIA_API_URL",
  VERBOSE_LOGGING = "true"
}

# Correct format
[env.development]
vars = { ENVIRONMENT = "development", AIRIA_API_URL = "YOUR_DEV_AIRIA_API_URL", VERBOSE_LOGGING = "true" }
```

#### Error when making API requests to Airia

If you see errors in the logs about API responses not being parsed correctly, check:
1. That your API endpoint is correctly set in wrangler.toml
2. That your API key is correctly set as a secret
3. That the API response format matches what the code expects (see "Customizing for Different API Formats" above)

#### Missing permissions errors in Slack

If you see errors related to permissions like `missing_scope` in your logs:
1. Go to your Slack App configuration > OAuth & Permissions
2. Make sure all required scopes are added (especially `channels:join` for thread summarization)
3. Reinstall the app to your workspace to apply the new permissions
4. For private channels, manually invite the bot with `/invite @AI Assistant`

#### Thread detection issues

If the "Summarize Thread" action is not correctly identifying threads:
1. Ensure the bot has `channels:history` and `channels:join` permissions
2. Check that the bot has been added to the channel
3. Try using the action on the first message in the thread (thread parent) - this works best
4. For private channels, use `/invite @AI Assistant` before using thread features
5. If summarizing a thread reply, ensure the parent message is still accessible

The thread detection has multiple fallback mechanisms to handle different Slack thread formats and edge cases:
- If a thread can't be processed due to an `invalid_arguments` error, it will fall back to single message summarization
- If all thread approaches fail, it will fall back to summarizing recent conversation instead
- If a single message can't be replied to, the bot will post the summary as a new message
- For best results, use the Summarize action on the first (parent) message of a thread

For enhanced debugging:
- Enable verbose logging by setting `VERBOSE_LOGGING = "true"` in your wrangler.toml
- This will provide detailed diagnostic information about:
  - Thread detection and timestamp validation
  - User information resolution
  - API request and response details
  - Message content and context
  - Error states and fallback mechanisms

If you encounter issues with specific messages, review the logs for detailed information about what happened.


