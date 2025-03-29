/**
 * Airia-Powered Slackbot
 * 
 * A Cloudflare Worker that connects Slack to the Airia API, enabling
 * teams to interact with Airia's capabilities directly from Slack.
 * 
 * This worker handles:
 * - Slack slash commands (/ask-airia)
 * - Slack Direct Messages to the bot
 * - Mentions of the bot in channels
 * - Slack home tab app configuration
 * 
 * Security features:
 * - Verifies Slack request signatures
 * - Uses environment variables for all secrets
 * - Configurable environment-based logging
 * - Production/development environment separation
 */

import crypto from 'crypto';

/**
 * Partial key logging to avoid exposing entire secrets in logs
 * Only for development environments - remove in production
 */
function partialKey(key) {
  if (!key) return 'undefined';
  return key.slice(0, 3) + '...'; // Show only first 3 chars
}

/**
 * Logger to confirm env vars are set
 * SECURITY NOTE: For development only - should be disabled in production
 * as it could leak partial secrets to logs
 */
function logEnvValues(env) {
  // Don't log in production
  if (env.ENVIRONMENT === 'production') {
    console.log('[ENV] Environment: production (skipping detailed logs)');
    return;
  }
  
  console.log('[ENV] AIRIA_API_URL is set:', !!env.AIRIA_API_URL);
  console.log('[ENV] Airia_API_key is set:', !!env.Airia_API_key);
  console.log('[ENV] Slack_Signing_Secret is set:', !!env.Slack_Signing_Secret);
  console.log('[ENV] Slack_Bot_Token is set:', !!env.Slack_Bot_Token);
}

/**
 * Worker in Modules format: export default { fetch() { ... } }
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Test route - only enabled in development environments
    if (url.pathname === '/test' && env.ENVIRONMENT !== 'production') {
      console.log('[TEST] Received /test request');
      
      // Check environment but don't log sensitive details
      console.log('[TEST] Environment:', env.ENVIRONMENT || 'not set');
      
      // Return basic health check response
      return new Response(JSON.stringify({ 
        status: 'ok',
        environment: env.ENVIRONMENT || 'development'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    // Block test route in production
    if (url.pathname === '/test' && env.ENVIRONMENT === 'production') {
      console.warn('[SECURITY] Test route accessed in production');
      return new Response('Not found', { status: 404 });
    }

    if (url.pathname === '/slack') {
      console.log('[SLACK] Received /slack request');
      logEnvValues(env);

      // 1) Slack signature checks
      const rawBody = await request.text();
      console.log('[SLACK] Raw request body:', rawBody);

      const timestamp = request.headers.get('X-Slack-Request-Timestamp');
      const slackSignature = request.headers.get('X-Slack-Signature');
      console.log('[SLACK] timestamp:', timestamp);
      console.log('[SLACK] slackSignature:', slackSignature);

      // Basic timestamp check (300s)
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - timestamp) > 300) {
        console.error('[SLACK] Timestamp too old:', timestamp);
        return new Response('Invalid request (timestamp too old)', { status: 400 });
      }

      // Verify Slack signature
      const baseString = `v0:${timestamp}:${rawBody}`;
      const computedHash = `v0=${crypto
        .createHmac('sha256', env.Slack_Signing_Secret)
        .update(baseString)
        .digest('hex')}`;

      if (computedHash !== slackSignature) {
        console.error('[SLACK] Invalid Slack signature');
        console.log('[SLACK] Computed Hash:', computedHash);
        console.log('[SLACK] Received Slack Signature:', slackSignature);
        return new Response('Invalid request (invalid signature)', { status: 401 });
      }
      console.log('[SLACK] Slack signature verified.');

      // 2) Parse Slack payload
      let payload;
      const contentType = request.headers.get('Content-Type') || '';
      if (contentType.includes('application/json')) {
        payload = JSON.parse(rawBody);
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        const params = new URLSearchParams(rawBody);
        payload = Object.fromEntries(params.entries());
      } else {
        console.error('[SLACK] Invalid content type:', contentType);
        return new Response('Invalid request format', { status: 400 });
      }

      console.log('[SLACK] Parsed payload:', payload);

      // Slack URL verification
      if (payload.type === 'url_verification') {
        console.log('[SLACK] Responding to Slack URL verification challenge...');
        return new Response(JSON.stringify({ challenge: payload.challenge }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Slash command /ask-airia
      if (payload.command && payload.command === '/ask-airia') {
        console.log('[SLASH] /ask-airia slash command');
        // Return 200 immediately
        const ack = new Response('OK', { status: 200 });
        ctx.waitUntil(processSlashCommand(payload, env));
        return ack;
      }

      // Event callback
      if (payload.type === 'event_callback') {
        const slackEvent = payload.event;
        console.log('[SLACK EVENT] Received event:', slackEvent);

        // Ignore bot's own messages
        if (slackEvent.bot_id) {
          console.log('[SLACK EVENT] Bot message, ignoring');
          return new Response('Bot message ignored', { status: 200 });
        }

        // Home tab
        if (slackEvent.type === 'app_home_opened') {
          console.log('[SLACK EVENT] app_home_opened for user:', slackEvent.user);
          const ack = new Response('OK', { status: 200 });
          ctx.waitUntil(updateHomeTab(slackEvent, env));
          return ack;
        }

        // DM
        if (slackEvent.type === 'message' && slackEvent.channel_type === 'im') {
          console.log(`[SLACK EVENT] DM from user ${slackEvent.user}: ${slackEvent.text}`);
          const ack = new Response('OK', { status: 200 });
          ctx.waitUntil(processDM(slackEvent, env));
          return ack;
        }

        // @mention
        if (slackEvent.type === 'app_mention') {
          console.log(`[SLACK EVENT] @mention from user ${slackEvent.user}: ${slackEvent.text}`);
          const ack = new Response('OK', { status: 200 });
          // We'll do ephemeral "thinking" + final answer
          ctx.waitUntil(processMention(slackEvent, env));
          return ack;
        }

        console.warn('[SLACK EVENT] Unhandled event type:', slackEvent.type);
        return new Response('Unhandled event', { status: 400 });
      }

      console.warn('[SLACK] Unhandled payload:', payload);
      return new Response('Unhandled Slack payload', { status: 400 });
    }

    // Not /slack or /test => 404
    console.warn('[WORKER] No matching route:', url.pathname);
    return new Response('Not found', { status: 404 });
  },
  
  /**
   * Add any additional Worker event handlers here:
   * 
   * scheduled: (event, env, ctx) => {
   *   // Handle scheduled events (cron jobs)
   * },
   * 
   * queue: (batch, env, ctx) => {
   *   // Process queued messages
   * },
   */
};

/**
 * Processes the /ask-airia slash command in background
 */
async function processSlashCommand(payload, env) {
  console.log('[SLASH] Processing slash command in background. userInput:', payload.text);
  try {
    const aiRes = await fetch(env.AIRIA_API_URL, {
      method: 'POST',
      headers: {
        'X-API-KEY': env.Airia_API_key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userInput: payload.text, asyncOutput: false }),
    });

    const rawText = await aiRes.text();
    console.log('[SLASH] Raw AI response:', rawText);

    if (!aiRes.ok) {
      console.error('[SLASH] Airia API error:', aiRes.status, aiRes.statusText);
      await fetch(payload.response_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `Airia API returned an error: ${aiRes.status} - ${aiRes.statusText}`,
        }),
      });
      return;
    }

    const aiJson = JSON.parse(rawText);
    console.log('[SLASH] AI parsed JSON:', aiJson);

    // Respond to Slack's response_url
    await fetch(payload.response_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `Result from Airia:\n*${aiJson.result}*\nIs Backup Pipeline: ${
          aiJson.isBackupPipeline ? 'Yes' : 'No'
        }`,
      }),
    });
    console.log('[SLASH] Done sending slash command result');
  } catch (err) {
    console.error('[SLASH] Error in slash command logic:', err);
  }
}

/**
 * Processes direct messages in background
 */
async function processDM(event, env) {
  console.log('[DM] user text:', event.text);
  try {
    const aiRes = await fetch(env.AIRIA_API_URL, {
      method: 'POST',
      headers: {
        'X-API-KEY': env.Airia_API_key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userInput: event.text, asyncOutput: false }),
    });

    const rawText = await aiRes.text();
    console.log('[DM] Raw AI response:', rawText);

    if (!aiRes.ok) {
      console.error('[DM] AI error:', aiRes.status, aiRes.statusText);
      await postSlackMessage(env, event.channel, `AI error: ${aiRes.status}`);
      return;
    }

    const aiJson = JSON.parse(rawText);
    const reply = `You asked: "${event.text}"\n\nResult: *${aiJson.result}*\nIs Backup Pipeline: ${
      aiJson.isBackupPipeline ? 'Yes' : 'No'
    }`;
    await postSlackMessage(env, event.channel, reply);
    console.log('[DM] Replied to user DM');
  } catch (err) {
    console.error('[DM] Error in processDM:', err);
    await postSlackMessage(env, event.channel, `Error in processDM: ${err}`);
  }
}

/**
 * Processes @mentions in background
 *  1) Immediately post ephemeral “thinking” face
 *  2) Then post final AI result
 */
async function processMention(event, env) {
  console.log('[MENTION] user text:', event.text);

  // (1) Immediately send ephemeral "thinking" message
  try {
    await postEphemeralMessage(env, {
      channel: event.channel,
      user: event.user,
      text: ':thinking_face: Working on it...',
    });
    console.log('[MENTION] Sent ephemeral thinking message');
  } catch (err) {
    console.error('[MENTION] Error sending ephemeral message:', err);
  }

  // (2) Do the AI call
  try {
    const aiRes = await fetch(env.AIRIA_API_URL, {
      method: 'POST',
      headers: {
        'X-API-KEY': env.Airia_API_key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userInput: event.text, asyncOutput: false }),
    });

    const rawText = await aiRes.text();
    console.log('[MENTION] Raw AI response:', rawText);

    if (!aiRes.ok) {
      console.error('[MENTION] AI error:', aiRes.status, aiRes.statusText);
      await postSlackMessage(env, event.channel, `AI error: ${aiRes.status}`);
      return;
    }

    const aiJson = JSON.parse(rawText);
    const msg = `You asked: "${event.text}"\n\n*${aiJson.result}*\nIs Backup Pipeline: ${
      aiJson.isBackupPipeline ? 'Yes' : 'No'
    }`;
    await postSlackMessage(env, event.channel, msg);
    console.log('[MENTION] Replied to user mention');
  } catch (err) {
    console.error('[MENTION] Error in processMention:', err);
    await postSlackMessage(env, event.channel, `Error in mention logic: ${err}`);
  }
}

/**
 * Updates the Slack home tab with instructions/examples
 */
async function updateHomeTab(event, env) {
  console.log('[HOME] Updating home tab for user:', event.user);

  const homeView = {
    type: 'home',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Welcome to the Airia Slackbot!* :wave:\n\nThis bot helps you interact with Airia\'s API effortlessly.',
        },
      },
      {
        type: 'divider',
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Available Features:*\n\nHere’s how you can use the Airia Slackbot:',
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*1. Slash Command:*\nUse `/ask-airia [your question]` to ask a question directly.\n\n_Example:_ `/ask-airia What is the capital of Georgia?`',
        },
      },
      {
        type: 'divider',
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*2. @Mention in a Channel:*\nMention the bot in a channel and ask a question.\n\n_Example:_ `@Ask Airia What is the weather today?`',
        },
      },
      {
        type: 'divider',
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*3. Direct Message:*\nSend a direct message to the bot with your question.\n\n_Example:_ `What is machine learning?`',
        },
      },
      {
        type: 'divider',
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: ':gear: *Need help?* Contact your Airia administrator for support.',
          },
        ],
      },
    ],
  };

  await fetch('https://slack.com/api/views.publish', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.Slack_Bot_Token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      user_id: event.user,
      view: homeView,
    }),
  });
  console.log('[HOME] Updated home tab content');
}

/**
 * Post a message to Slack in background tasks
 */
async function postSlackMessage(env, channel, text) {
  console.log('[SLACK POST] channel:', channel, ' text:', text);
  await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.Slack_Bot_Token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ channel, text }),
  });
}

/**
 * Post an ephemeral message to Slack (visible only to `user` in `channel`)
 */
async function postEphemeralMessage(env, { channel, user, text }) {
  console.log('[SLACK EPHEMERAL] channel:', channel, ' user:', user, ' text:', text);
  const response = await fetch('https://slack.com/api/chat.postEphemeral', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.Slack_Bot_Token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ channel, user, text }),
  });
  const json = await response.json();
  console.log('[SLACK EPHEMERAL] postEphemeral response:', json);
}

/**
 * Removed test route background logic for security
 * Any debugging functionality should be properly secured
 * and disabled in production environments
 */