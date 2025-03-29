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

      // 1) Get the raw body first for all request types
      const rawBody = await request.text();
      console.log('[SLACK] Raw request body:', rawBody);
      
      // Special handling for URL verification - skip signature checks
      try {
        const jsonBody = JSON.parse(rawBody);
        if (jsonBody.type === 'url_verification') {
          console.log('[SLACK] Detected URL verification challenge!');
          return new Response(JSON.stringify({ challenge: jsonBody.challenge }), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
      } catch (e) {
        // Not JSON or not a challenge - continue with normal flow
        console.log('[SLACK] Not a URL verification challenge, continuing...');
      }

      // 2) Normal Slack signature checks for non-challenge requests
      const timestamp = request.headers.get('X-Slack-Request-Timestamp');
      const slackSignature = request.headers.get('X-Slack-Signature');
      console.log('[SLACK] timestamp:', timestamp);
      console.log('[SLACK] slackSignature:', slackSignature);

      // Skip signature check if secret is not set (for initial URL verification)
      if (!env.Slack_Signing_Secret) {
        console.warn('[SLACK] Signing secret not set - skipping signature verification');
      } else {
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
      }

      // 3) Parse Slack payload
      let payload;
      const contentType = request.headers.get('Content-Type') || '';
      if (contentType.includes('application/json')) {
        // Already parsed for challenge check
        payload = JSON.parse(rawBody);
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        const params = new URLSearchParams(rawBody);
        payload = Object.fromEntries(params.entries());
        
        // For payloads containing JSON strings (like interactive components)
        if (payload.payload) {
          try {
            payload = JSON.parse(payload.payload);
          } catch (err) {
            console.error('[SLACK] Error parsing payload JSON:', err);
          }
        }
      } else {
        console.error('[SLACK] Invalid content type:', contentType);
        return new Response('Invalid request format', { status: 400 });
      }

      console.log('[SLACK] Parsed payload:', payload);

      // Slack URL verification (redundant but keeping for clarity)
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

      // Interactive components (message actions, shortcuts, modals, etc.)
      if (payload.type === 'message_action' || payload.type === 'block_actions' || 
          payload.type === 'shortcut' || payload.type === 'workflow_step' ||
          payload.type === 'view_submission') {
        console.log('[INTERACTIVE] Interactive component triggered:', payload.type);
        console.log('[INTERACTIVE] Payload details:', JSON.stringify(payload, null, 2));
        
        // Handle message action: "Summarize"
        if (payload.type === 'message_action' && payload.callback_id === 'summarize_thread') {
          // For message actions, return an empty JSON object with content-type application/json
          // This ensures Slack doesn't show an error dialog
          const ack = new Response('{}', { 
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
          ctx.waitUntil(processThreadSummary(payload, env));
          return ack;
        } 
        // Handle global shortcut: "Ask AI Assistant"
        else if (payload.type === 'shortcut' && payload.callback_id === 'ask_airia_shortcut') {
          // For shortcuts, use JSON response too
          const ack = new Response('{}', { 
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
          // IMPORTANT: For shortcuts, we need to respond quickly
          // So we'll start processing after sending the initial response
          ctx.waitUntil(processAskAiriaShortcut(payload, env));
          return ack;
        } 
        // Handle workflow step: "Generate response"
        else if (payload.type === 'workflow_step' && payload.callback_id === 'generate_response') {
          const ack = new Response('{}', { 
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
          ctx.waitUntil(processWorkflowStep(payload, env));
          return ack;
        }
        // Handle modal submissions
        else if (payload.type === 'view_submission') {
          console.log('[MODAL] View submission received:', payload.view.callback_id);
          
          // Check which modal was submitted using the callback_id
          if (payload.view.callback_id === 'ask_ai_assistant_modal') {
            // Process the AI Assistant question modal
            // We'll do this in the background to avoid blocking
            const ack = new Response('{}', { 
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
            ctx.waitUntil(handleViewSubmission(payload, env));
            return ack;
          } else {
            // For any other modal types, handle synchronously
            console.log('[MODAL] Unknown modal type:', payload.view.callback_id);
            return new Response('{}', {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          }
        } else {
          console.log('[INTERACTIVE] Unhandled interactive component:', payload);
          return new Response('{}', { 
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }

      // Link unfurling
      if (payload.type === 'event_callback' && payload.event && payload.event.type === 'link_shared') {
        console.log('[UNFURL] Link shared event:', payload.event);
        const ack = new Response('OK', { status: 200 });
        ctx.waitUntil(processLinkUnfurl(payload.event, env));
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
        text: `Result from AI Assistant:\n*${aiJson.result}*\nIs Backup Pipeline: ${
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
 *  1) Immediately post ephemeral "thinking" face
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
          text: '*Welcome to the AI Assistant!* :wave:\n\nThis bot helps you interact with AI services effortlessly.',
        },
      },
      {
        type: 'divider',
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Available Features:*\n\nHere\'s how you can use the AI Assistant:',
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
          text: '*2. @Mention in a Channel:*\nMention the bot in a channel and ask a question.\n\n_Example:_ `@AI Assistant What is the weather today?`',
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
            text: ':gear: *Need help?* Contact your administrator for support.',
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
 * @param {Object} env - Environment variables
 * @param {string} channel - Slack channel ID
 * @param {string} text - Message text
 * @param {string} [thread_ts] - Optional thread timestamp to reply to a thread
 * @param {Object} [blocks] - Optional blocks for rich formatting
 */
async function postSlackMessage(env, channel, text, thread_ts = null, blocks = null) {
  console.log('[SLACK POST] channel:', channel, ' text:', text, thread_ts ? ' (in thread)' : '');
  
  const message = { 
    channel, 
    text 
  };
  
  // Add thread_ts if provided (for thread replies)
  if (thread_ts) {
    message.thread_ts = thread_ts;
  }
  
  // Add blocks if provided (for rich formatting)
  if (blocks) {
    message.blocks = blocks;
  }
  
  await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.Slack_Bot_Token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(message),
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
 * Handles "Summarize" message action
 * This allows users to summarize threads, single messages, or recent conversations
 */
async function processThreadSummary(payload, env) {
  console.log('[SUMMARY] Processing summarize request');
  console.log('[SUMMARY] Payload:', JSON.stringify(payload, null, 2));
  
  try {
    // Extract channel ID and message timestamp based on payload structure
    // The payload structure can vary based on how the action was triggered
    let channelId, messageTs, userId;
    
    // Handle different payload structures
    if (payload.channel && typeof payload.channel === 'string') {
      // Direct channel ID in payload
      channelId = payload.channel;
    } else if (payload.channel && payload.channel.id) {
      // Channel object in payload
      channelId = payload.channel.id;
    } else if (payload.message && payload.message.channel) {
      // Channel in message object
      channelId = payload.message.channel;
    } else {
      throw new Error('Could not determine channel ID from payload');
    }
    
    // Get message timestamp
    if (payload.message_ts) {
      messageTs = payload.message_ts;
    } else if (payload.message && payload.message.ts) {
      messageTs = payload.message.ts;
    } else if (payload.container && payload.container.message_ts) {
      messageTs = payload.container.message_ts;
    } else {
      throw new Error('Could not determine message timestamp from payload');
    }
    
    // Get user ID
    if (payload.user && typeof payload.user === 'string') {
      userId = payload.user;
    } else if (payload.user && payload.user.id) {
      userId = payload.user.id;
    } else if (payload.user_id) {
      userId = payload.user_id;
    } else {
      throw new Error('Could not determine user ID from payload');
    }
    
    console.log('[THREAD_SUMMARY] Extracted info:', { 
      channelId, 
      messageTs, 
      userId 
    });
    
    // Step 1: Retrieve the conversation history to get the thread
    console.log('[THREAD_SUMMARY] Fetching thread with params:', {
      channel: channelId,
      ts: messageTs
    });
    
    // Add a small delay to make sure Slack has processed the message
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Send an explicit "thinking" message to the user first
    await postEphemeralMessage(env, {
      channel: channelId,
      user: userId,
      text: `:thinking_face: Processing thread summary...`,
    });
    
    // Try to join the channel first if it's a public channel
    try {
      const joinResponse = await fetch(`https://slack.com/api/conversations.join`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.Slack_Bot_Token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel: channelId
        }),
      });
      
      const joinData = await joinResponse.json();
      console.log('[THREAD_SUMMARY] Channel join attempt:', 
        joinData.ok ? 'Joined successfully' : `Failed: ${joinData.error}`);
      
      // For private channels, join will fail but that's expected
    } catch (joinErr) {
      console.log('[THREAD_SUMMARY] Channel join error (expected for private channels):', joinErr.message);
    }
    
    // Now try to fetch the message
    let parentMsgData;
    let isThread = false;  // Initialize the thread status flag
    let firstMessage = null;
    
    try {
      const parentMsgResponse = await fetch(`https://slack.com/api/conversations.history`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.Slack_Bot_Token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel: channelId,
          latest: messageTs,
          limit: 1,
          inclusive: true
        }),
      });
      
      parentMsgData = await parentMsgResponse.json();
      console.log('[SUMMARY] Parent message check:', 
        parentMsgData.ok ? 'Message found' : `Error: ${parentMsgData.error}`);
      
      if (!parentMsgData.ok) {
        console.error('[SUMMARY] Failed to retrieve parent message:', parentMsgData.error);
        
        let errorMessage = `Error retrieving message: ${parentMsgData.error}.`;
        
        if (parentMsgData.error === 'not_in_channel') {
          errorMessage = `The bot needs to be added to this channel. Please add @AI Assistant to the channel and try again.`;
        } else if (parentMsgData.error === 'channel_not_found') {
          errorMessage = `The bot can't access this channel. For private channels, please add @AI Assistant to the channel first.`;
        } else if (parentMsgData.error === 'missing_scope') {
          errorMessage = `The bot is missing required permissions. Please reinstall the app with the needed scopes.`;
        }
        
        await postEphemeralMessage(env, {
          channel: channelId,
          user: userId,
          text: errorMessage,
        });
        return;
      }
      
      if (!parentMsgData.messages || parentMsgData.messages.length === 0) {
        console.error('[SUMMARY] Parent message not found');
        await postEphemeralMessage(env, {
          channel: channelId,
          user: userId,
          text: `Error: Could not find the parent message. The message may have been deleted or the bot doesn't have permission to view it.`,
        });
        return;
      }
      
      // Check if the message is a thread parent or reply
      firstMessage = parentMsgData.messages[0];
      
      // If this is a reply in a thread, we need to get the parent message's timestamp
      if (firstMessage.thread_ts && firstMessage.thread_ts !== messageTs) {
        console.log('[SUMMARY] This is a reply in a thread, using thread_ts instead:', firstMessage.thread_ts);
        messageTs = firstMessage.thread_ts;
      }
      
      // Check if it's a thread or not
      isThread = !!(firstMessage.thread_ts || firstMessage.reply_count);
      console.log('[SUMMARY] Is message part of a thread?', isThread);
      
    } catch (accessErr) {
      console.error('[SUMMARY] Error accessing channel:', accessErr);
      await postEphemeralMessage(env, {
        channel: channelId,
        user: userId,
        text: `Error accessing the channel: ${accessErr.message}. Please check that the bot has proper permissions.`,
      });
      return;
    }
    
    // Now get either thread replies or recent messages
    try {
      let messages = [];
      let contextType = '';
      
      // isThread is now properly initialized above
      
      // Branch based on whether it's a thread or regular message
      if (isThread) {
        // Get thread replies for a threaded message
        const threadResponse = await fetch(`https://slack.com/api/conversations.replies`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.Slack_Bot_Token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            channel: channelId,
            ts: messageTs,
          }),
        });
        
        const threadData = await threadResponse.json();
        console.log('[SUMMARY] Thread replies response:', 
          threadData.ok ? 
          `Success (found ${threadData.messages ? threadData.messages.length : 0} messages)` : 
          `Error: ${threadData.error}`
        );
        
        if (!threadData.ok) {
          console.error('[SUMMARY] Failed to retrieve thread:', threadData.error);
          let errorMessage = `Error retrieving thread: ${threadData.error}`;
          
          if (threadData.error === 'invalid_arguments') {
            // Even though we detected a thread earlier, we couldn't retrieve it
            // Switch to non-thread context
            console.log('[SUMMARY] Switching to non-thread context...');
            messages = [firstMessage];
            contextType = 'single message';
          } else if (threadData.error === 'thread_not_found') {
            // Same as above
            console.log('[SUMMARY] Thread not found, switching to non-thread context...');
            messages = [firstMessage];
            contextType = 'single message';
          } else if (threadData.error === 'channel_not_found') {
            errorMessage = `The bot doesn't have access to this channel. Please add the bot to the channel and try again.`;
            await postEphemeralMessage(env, {
              channel: channelId,
              user: userId,
              text: errorMessage,
            });
            return;
          } else {
            await postEphemeralMessage(env, {
              channel: channelId,
              user: userId,
              text: errorMessage,
            });
            return;
          }
        } else {
          // We successfully got thread replies
          messages = threadData.messages;
          contextType = 'thread';
          
          // Check if there are actually replies
          if (messages.length <= 1) {
            console.log('[SUMMARY] Thread has no replies, switching to non-thread context');
            // If there's just one message, treat it as a regular message
            messages = [firstMessage];
            contextType = 'single message';
          }
        }
      } else {
        // For non-threaded messages, get recent messages in the channel
        console.log('[SUMMARY] Not a thread, fetching context from conversation history');
        
        // Get recent messages (up to 10) to provide context
        const historyResponse = await fetch(`https://slack.com/api/conversations.history`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.Slack_Bot_Token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            channel: channelId,
            limit: 10, // Get last 10 messages
          }),
        });
        
        const historyData = await historyResponse.json();
        if (!historyData.ok) {
          console.error('[SUMMARY] Failed to retrieve history:', historyData.error);
          await postEphemeralMessage(env, {
            channel: channelId,
            user: userId,
            text: `Error retrieving message history: ${historyData.error}`,
          });
          return;
        }
        
        // Use the recent messages as context
        messages = historyData.messages;
        contextType = 'recent conversation';
      }
      
      // Format the messages for the AI
      let messageText = messages
        .map(msg => `${msg.user || 'User'}: ${msg.text}`)
        .join('\n');
      
      // Limit the text size if it's too large
      if (messageText.length > 10000) {
        console.log('[SUMMARY] Truncating long message text');
        messageText = messageText.substring(0, 10000) + '... (truncated)';
      }
      
      console.log(`[SUMMARY] Processing ${contextType} with ${messages.length} messages`);
      
      // Call the AI API with the context
      const promptMap = {
        'thread': 'Summarize this conversation thread:',
        'single message': 'Summarize this message:',
        'recent conversation': 'Summarize these recent messages from a conversation:'
      };
      
      const prompt = promptMap[contextType] || 'Summarize this:';
      
      const aiRes = await fetch(env.AIRIA_API_URL, {
        method: 'POST',
        headers: {
          'X-API-KEY': env.Airia_API_key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          userInput: `${prompt} ${messageText}`, 
          asyncOutput: false
        }),
      });
      
      if (!aiRes.ok) {
        console.error('[SUMMARY] Airia API error:', aiRes.status);
        await postEphemeralMessage(env, {
          channel: channelId,
          user: userId,
          text: `Error summarizing: API error ${aiRes.status}`,
        });
        return;
      }
      
      // Parse and post the summary
      const aiJson = JSON.parse(await aiRes.text());
      
      // Create a title based on the context type
      const titleMap = {
        'thread': '*Thread Summary:*',
        'single message': '*Message Summary:*',
        'recent conversation': '*Conversation Summary:*'
      };
      
      const title = titleMap[contextType] || '*Summary:*';
      
      // For thread, post as a reply; for others, post as a new message
      if (contextType === 'thread') {
        await postSlackMessage(env, channelId, `${title}\n${aiJson.result}`, messageTs);
      } else {
        await postSlackMessage(env, channelId, `${title}\n${aiJson.result}`);
      }
      
      console.log(`[SUMMARY] Posted ${contextType} summary successfully`);
      
    } catch (processingErr) {
      console.error('[SUMMARY] Error processing content:', processingErr);
      await postEphemeralMessage(env, {
        channel: channelId,
        user: userId,
        text: `Error processing content: ${processingErr.message}`,
      });
    }
    
    // All thread processing now happens inside the try/catch block above
  } catch (err) {
    console.error('[SUMMARY] Error:', err);
    try {
      // Try to notify the user of the error with best-effort information extraction
      let channelId = (
        (payload.channel && payload.channel.id) || 
        (payload.channel && typeof payload.channel === 'string' && payload.channel) || 
        (payload.message && payload.message.channel)
      );
      
      let userId = (
        (payload.user && payload.user.id) || 
        (payload.user && typeof payload.user === 'string' && payload.user) || 
        payload.user_id
      );
      
      if (channelId && userId) {
        await postEphemeralMessage(env, {
          channel: channelId,
          user: userId,
          text: `Error processing thread summary: ${err.message}`,
        });
      } else {
        console.error('[THREAD_SUMMARY] Could not send error message: missing channel or user ID');
      }
    } catch (postErr) {
      console.error('[THREAD_SUMMARY] Failed to send error message:', postErr);
    }
  }
}

/**
 * Handles "Ask AI Assistant" global shortcut
 * Opens a modal dialog for users to ask a question from anywhere
 */
async function processAskAiriaShortcut(payload, env) {
  console.log('[SHORTCUT] Processing Ask AI Assistant shortcut');
  console.log('[SHORTCUT] Payload:', JSON.stringify(payload, null, 2));
  
  try {
    // Validate the trigger ID is present
    if (!payload.trigger_id) {
      console.error('[SHORTCUT] Missing trigger_id in payload');
      return;
    }

    // Keep track of when the request was sent for timeout tracking
    const startTime = Date.now();
    
    // Open a modal for the user to input their question
    const modalView = {
      type: 'modal',
      callback_id: 'ask_ai_assistant_modal',
      title: {
        type: 'plain_text',
        text: 'Ask AI Assistant',
      },
      submit: {
        type: 'plain_text',
        text: 'Ask',
      },
      close: {
        type: 'plain_text',
        text: 'Cancel',
      },
      blocks: [
        {
          type: 'input',
          block_id: 'question_block',
          element: {
            type: 'plain_text_input',
            action_id: 'question',
            multiline: true,
            placeholder: {
              type: 'plain_text',
              text: 'What would you like to ask?',
            },
          },
          label: {
            type: 'plain_text',
            text: 'Question',
          },
        },
      ],
    };
    
    console.log('[SHORTCUT] Opening modal with trigger_id:', payload.trigger_id);
    
    // Set a timeout for the request - Slack needs fast responses
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    
    try {
      const modalResponse = await fetch('https://slack.com/api/views.open', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.Slack_Bot_Token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          trigger_id: payload.trigger_id,
          view: modalView
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      const responseTime = Date.now() - startTime;
      console.log(`[SHORTCUT] Slack API response time: ${responseTime}ms`);
      
      if (!modalResponse.ok) {
        console.error('[SHORTCUT] HTTP error:', modalResponse.status, modalResponse.statusText);
        return;
      }
      
      const modalData = await modalResponse.json();
      console.log('[SHORTCUT] Modal response:', JSON.stringify(modalData, null, 2));
      
      if (!modalData.ok) {
        console.error('[SHORTCUT] Failed to open modal:', modalData.error);
        if (modalData.error === 'trigger_expired') {
          console.error('[SHORTCUT] Trigger ID expired (response took too long)');
        }
      } else {
        console.log('[SHORTCUT] Modal opened successfully with view ID:', modalData.view?.id);
      }
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      if (fetchErr.name === 'AbortError') {
        console.error('[SHORTCUT] Request timed out after 2000ms');
      } else {
        console.error('[SHORTCUT] Fetch error:', fetchErr);
      }
    }
  } catch (err) {
    console.error('[SHORTCUT] Error processing shortcut:', err);
  }
}

/**
 * Handle modal submissions 
 */
async function handleViewSubmission(payload, env) {
  const viewId = payload.view.id;
  const userId = payload.user.id;
  console.log(`[MODAL] Received submission from view ${viewId} by user ${userId}`);
  console.log('[MODAL] View structure:', JSON.stringify(payload.view, null, 2));

  try {
    // Extract the question from the modal submission - traverse the state structure carefully
    let question = '';
    
    try {
      // First try the expected structure
      question = payload.view.state.values.question_block.question.value;
    } catch (structErr) {
      // If that fails, log the error and try to find the question more broadly
      console.error('[MODAL] Error accessing question using expected structure:', structErr);
      console.log('[MODAL] Attempting to find question in view state');
      
      // Try to find any input with content
      if (payload.view.state && payload.view.state.values) {
        const blocks = Object.keys(payload.view.state.values);
        for (const block of blocks) {
          const actions = Object.keys(payload.view.state.values[block]);
          for (const action of actions) {
            const value = payload.view.state.values[block][action].value;
            if (value) {
              console.log(`[MODAL] Found input value in block ${block}, action ${action}`);
              question = value;
              break;
            }
          }
          if (question) break;
        }
      }
    }
    
    // Check if we found a question
    if (!question || question.trim() === '') {
      console.log('[MODAL] Empty question submitted or question not found in payload');
      // Since we're now handling this in the background, we can't return errors
      // so we'll just log the error and exit
      return;
    }
    
    console.log(`[MODAL] Processing question: ${question}`);
    
    // Get the user's DM channel to send the response
    const dmResponse = await fetch('https://slack.com/api/conversations.open', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.Slack_Bot_Token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        users: userId
      })
    });
    
    const dmData = await dmResponse.json();
    if (!dmData.ok) {
      console.error('[MODAL] Failed to open DM channel:', dmData.error);
      return;
    }
    
    const channelId = dmData.channel.id;
    
    // Send a "thinking" message
    try {
      await postSlackMessage(env, channelId, `:thinking_face: Processing your question: "${question}"`);
    } catch (msgErr) {
      console.error('[MODAL] Error sending thinking message:', msgErr);
      // Continue anyway - this is just a notification
    }
    
    // Call the AI API with proper error handling
    try {
      const aiRes = await fetch(env.AIRIA_API_URL, {
        method: 'POST',
        headers: {
          'X-API-KEY': env.Airia_API_key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userInput: question, asyncOutput: false }),
      });
      
      if (!aiRes.ok) {
        console.error('[MODAL] AI API error:', aiRes.status, aiRes.statusText);
        await postSlackMessage(env, channelId, `Error processing your question: API returned status ${aiRes.status}. Please try again later.`);
        return;
      }
      
      const responseText = await aiRes.text();
      console.log('[MODAL] Raw AI response:', responseText);
      
      try {
        // Try to parse the JSON response
        const aiJson = JSON.parse(responseText);
        
        // Format response with better fallbacks
        const result = aiJson.result || aiJson.answer || aiJson.response || 
                     (typeof aiJson === 'string' ? aiJson : 'No readable response received');
        
        await postSlackMessage(env, channelId, `You asked: "${question}"\n\n*${result}*`);
        console.log('[MODAL] Replied to user question via DM');
      } catch (parseErr) {
        console.error('[MODAL] Error parsing AI response:', parseErr);
        // If we can't parse the JSON, just send the raw text as fallback
        await postSlackMessage(env, channelId, `You asked: "${question}"\n\n*Response:*\n${responseText.substring(0, 1500)}`);
      }
    } catch (aiErr) {
      console.error('[MODAL] Error calling AI API:', aiErr);
      await postSlackMessage(env, channelId, `Error calling AI service: ${aiErr.message}. Please try again later.`);
    }
  } catch (err) {
    console.error('[MODAL] Error processing modal submission:', err);
    try {
      // Try to notify the user about the error
      const dmResponse = await fetch('https://slack.com/api/conversations.open', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.Slack_Bot_Token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          users: userId
        })
      });
      
      if (dmResponse.ok) {
        const dmData = await dmResponse.json();
        if (dmData.ok) {
          await postSlackMessage(env, dmData.channel.id, 
            `Sorry, there was an error processing your request: ${err.message}. Please try again.`);
        }
      }
    } catch (notifyErr) {
      console.error('[MODAL] Failed to notify user of error:', notifyErr);
    }
  }
}

/**
 * Handles link unfurling for domains specified in the app manifest
 */
async function processLinkUnfurl(event, env) {
  console.log('[UNFURL] Processing link unfurl for links:', event.links);
  try {
    // Example of unfurling links from yourdomain.com
    const unfurls = {};
    
    for (const link of event.links) {
      if (link.domain === 'yourdomain.com') {
        // You would typically fetch metadata about the link here
        // For demonstration, we'll create a simple unfurl
        unfurls[link.url] = {
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Link Preview from AI Assistant*\n${link.url}`,
              },
            },
            {
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: 'Powered by AI Assistant',
                },
              ],
            },
          ],
        };
      }
    }
    
    if (Object.keys(unfurls).length > 0) {
      const unfurlResponse = await fetch('https://slack.com/api/chat.unfurl', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.Slack_Bot_Token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel: event.channel,
          ts: event.message_ts,
          unfurls,
        }),
      });
      
      const unfurlData = await unfurlResponse.json();
      if (!unfurlData.ok) {
        console.error('[UNFURL] Failed to unfurl links:', unfurlData.error);
      } else {
        console.log('[UNFURL] Links unfurled successfully');
      }
    }
  } catch (err) {
    console.error('[UNFURL] Error processing link unfurl:', err);
  }
}

/**
 * Handles the "Generate response" workflow step
 */
async function processWorkflowStep(payload, env) {
  console.log('[WORKFLOW] Processing workflow step:', payload.callback_id);
  
  try {
    if (payload.type === 'workflow_step_edit') {
      // Step 1: Open a configuration modal when user adds this step to a workflow
      await fetch('https://slack.com/api/workflows.updateStep', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.Slack_Bot_Token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workflow_step_edit_id: payload.workflow_step.workflow_step_edit_id,
          inputs: {
            prompt: {
              value: "{{workflow_step_input}}",
              skip_variable_replacement: true,
            }
          },
          outputs: [
            {
              name: "response",
              type: "text",
              label: "AI Response"
            }
          ]
        })
      });
      console.log('[WORKFLOW] Configuration modal opened');
    }
    else if (payload.type === 'workflow_step_execute') {
      // Step 2: Execute the workflow step when triggered in a workflow
      const inputs = payload.workflow_step.inputs;
      const prompt = inputs.prompt.value;
      
      // Call Airia API with the input
      const aiRes = await fetch(env.AIRIA_API_URL, {
        method: 'POST',
        headers: {
          'X-API-KEY': env.Airia_API_key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userInput: prompt, asyncOutput: false }),
      });
      
      if (!aiRes.ok) {
        console.error('[WORKFLOW] Airia API error:', aiRes.status);
        await fetch('https://slack.com/api/workflows.stepFailed', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.Slack_Bot_Token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            workflow_step_execute_id: payload.workflow_step.workflow_step_execute_id,
            error: {
              message: `Airia API error: ${aiRes.status}`
            }
          })
        });
        return;
      }
      
      // Parse response and complete the workflow step
      const aiJson = JSON.parse(await aiRes.text());
      await fetch('https://slack.com/api/workflows.stepCompleted', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.Slack_Bot_Token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workflow_step_execute_id: payload.workflow_step.workflow_step_execute_id,
          outputs: {
            response: aiJson.result
          }
        })
      });
      console.log('[WORKFLOW] Workflow step completed successfully');
    }
  } catch (err) {
    console.error('[WORKFLOW] Error processing workflow step:', err);
    // Notify Slack that the step failed
    try {
      await fetch('https://slack.com/api/workflows.stepFailed', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.Slack_Bot_Token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workflow_step_execute_id: payload.workflow_step.workflow_step_execute_id,
          error: {
            message: `Error: ${err.message}`
          }
        })
      });
    } catch (postErr) {
      console.error('[WORKFLOW] Failed to report workflow step failure:', postErr);
    }
  }
}

/**
 * Removed test route background logic for security
 * Any debugging functionality should be properly secured
 * and disabled in production environments
 */