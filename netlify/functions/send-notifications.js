// Import necessary libraries
const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');

// Handler function that Netlify will execute
exports.handler = async function(event, context) {
    console.log("--- Starting Notification Function ---");
    try {
        // --- 1. Initialize Supabase and Web Push ---
        console.log("Initializing Supabase and Web Push...");
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );

        webpush.setVapidDetails(
            'mailto:your-email@example.com', // Replace with a valid email
            process.env.VAPID_PUBLIC_KEY,
            process.env.VAPID_PRIVATE_KEY
        );
        
        // --- 2. Define Time and Intervals ---
        const now = new Date();
        const riyadhTime = new Date(now.getTime() + 3 * 60 * 60 * 1000);
        console.log(`Function run time (UTC): ${now.toISOString()}`);
        console.log(`Adjusted time (Riyadh): ${riyadhTime.toISOString()}`);
        
        const currentMinute = riyadhTime.getMinutes();
        const currentHour = riyadhTime.getHours();
        const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

        // --- 3. Fetch all users with active push subscriptions ---
        console.log("Fetching users with subscriptions...");
        const { data: users, error: usersError } = await supabase
            .from('users')
            .select('name, push_subscription')
            .not('push_subscription', 'is', null);

        if (usersError) {
            throw new Error(`Error fetching users: ${usersError.message}`);
        }

        if (!users || users.length === 0) {
            console.log("No users with active subscriptions. Exiting.");
            return { statusCode: 200, body: "No users with subscriptions." };
        }
        console.log(`Found ${users.length} user(s) with subscriptions.`);
        
        // --- 4. Process notifications for each user ---
        for (const user of users) {
            console.log(`\nProcessing notifications for user: ${user.name}`);
            const subscription = user.push_subscription;
            const ownerName = user.name;
            
            // --- Daily Summaries (run at specific times) ---
            const isWithinFirst5Minutes = currentMinute >= 0 && currentMinute < 5;

            // Rule 1: Daily appointments summary at 7:00 AM
            if (currentHour === 7 && isWithinFirst5Minutes) {
                console.log(`Running daily event summary for ${user.name} at 7 AM.`);
                const todayStart = new Date(riyadhTime); todayStart.setHours(0, 0, 0, 0);
                const todayEnd = new Date(riyadhTime); todayEnd.setHours(23, 59, 59, 999);

                const { data: todaysEvents } = await supabase
                    .from('events').select('title').or(`owner.eq.${ownerName},is_shared.eq.true`)
                    .gte('event_date', todayStart.toISOString()).lte('event_date', todayEnd.toISOString());

                if (todaysEvents && todaysEvents.length > 0) {
                    const titles = todaysEvents.map(e => e.title).join('، ');
                    await sendNotification(supabase, subscription, {
                        title: `ملخص مواعيد اليوم (${todaysEvents.length})`,
                        body: `لديك اليوم المواعيد التالية: ${titles}`
                    });
                }
            }
            
            // Rule 2: On-track tasks summary at 8:00 AM
            if (currentHour === 8 && isWithinFirst5Minutes) {
                console.log(`Running on-track tasks summary for ${user.name} at 8 AM.`);
                 const { data: onTrackTasks } = await supabase
                    .from('tasks').select('title').or(`owner.eq.${ownerName},is_shared.eq.true`)
                    .eq('status', 'تنفيذ').gte('due_datetime', now.toISOString());
                if (onTrackTasks && onTrackTasks.length > 0) {
                     await sendNotification(supabase, subscription, {
                        title: `لديك ${onTrackTasks.length} مهام قيد التنفيذ`,
                        body: onTrackTasks.map(t => t.title).join('، ')
                    });
                }
            }

            // Rule 3: Overdue tasks summary at 9:00 AM
            if (currentHour === 9 && isWithinFirst5Minutes) {
                console.log(`Running overdue tasks summary for ${user.name} at 9 AM.`);
                const { data: overdueTasks } = await supabase
                    .from('tasks').select('title').or(`owner.eq.${ownerName},is_shared.eq.true`)
                    .eq('status', 'تنفيذ').lt('due_datetime', now.toISOString());
                if (overdueTasks && overdueTasks.length > 0) {
                     await sendNotification(supabase, subscription, {
                        title: `لديك ${overdueTasks.length} مهام متأخرة`,
                        body: `المهام المتأخرة: ${overdueTasks.map(t => t.title).join('، ')}`
                    });
                }
            }

            // --- Time-sensitive Reminders ---
            
            // Rules 4 & 5: Event reminders
            const { data: upcomingEvents } = await supabase
                .from('events').select('title, event_date').or(`owner.eq.${ownerName},is_shared.eq.true`)
                .gte('event_date', fiveMinutesAgo.toISOString());
            
            if (upcomingEvents && upcomingEvents.length > 0) {
                console.log(`Found ${upcomingEvents.length} upcoming event(s).`);
                for (const event of upcomingEvents) {
                    const eventTime = new Date(event.event_date);
                    const reminders = [
                        { diff: 48 * 60, body: `موعد "${event.title}" بعد 48 ساعة.` },
                        { diff: 24 * 60, body: `موعد "${event.title}" غداً.` },
                        { diff: 2 * 60, body: `موعد "${event.title}" بعد ساعتين.` },
                        { diff: 0, body: `حان الآن وقت موعد "${event.title}".` },
                    ];
                    for (const rem of reminders) {
                        if (shouldSendReminder(eventTime, now, rem.diff)) {
                            console.log(`SENDING event notification for "${event.title}" to ${user.name}. Reason: ${rem.diff} mins before.`);
                            await sendNotification(supabase, subscription, { title: 'تذكير بموعد', body: rem.body });
                        }
                    }
                }
            } else {
                console.log("No upcoming events found for this user.");
            }
            
            // Rule 6: Planning task reminder
            const { data: planningTasks } = await supabase
                .from('tasks').select('title, start_datetime').or(`owner.eq.${ownerName},is_shared.eq.true`)
                .eq('status', 'تخطيط').gte('start_datetime', fiveMinutesAgo.toISOString());

            if (planningTasks && planningTasks.length > 0) {
                 console.log(`Found ${planningTasks.length} planning task(s).`);
                 for (const task of planningTasks) {
                    if (shouldSendReminder(new Date(task.start_datetime), now, 24 * 60)) {
                         console.log(`SENDING planning task notification for "${task.title}" to ${user.name}.`);
                         await sendNotification(supabase, subscription, {
                            title: 'تذكير ببدء مهمة',
                            body: `سيبدأ تنفيذ مهمة "${task.title}" غداً.`
                        });
                    }
                }
            }
           
            // Rule 7: Execution task reminder
            const { data: executionTasks } = await supabase
                .from('tasks').select('title, due_datetime').or(`owner.eq.${ownerName},is_shared.eq.true`)
                .eq('status', 'تنفيذ').gte('due_datetime', fiveMinutesAgo.toISOString());

             if (executionTasks && executionTasks.length > 0) {
                console.log(`Found ${executionTasks.length} execution task(s).`);
                for (const task of executionTasks) {
                    if (shouldSendReminder(new Date(task.due_datetime), now, 24 * 60)) {
                        console.log(`SENDING execution task notification for "${task.title}" to ${user.name}.`);
                        await sendNotification(supabase, subscription, {
                            title: 'تذكير بانتهاء مهمة',
                            body: `الوقت المحدد لمهمة "${task.title}" ينتهي غداً.`
                        });
                    }
                }
            }
        }

        console.log("--- Notification Function Finished Successfully ---");
        return { statusCode: 200, body: "Notifications processed." };

    } catch (error) {
        console.error("!!! FATAL ERROR in notification function:", error);
        return { statusCode: 500, body: `Error: ${error.message}` };
    }
};

// --- Helper Functions ---
function shouldSendReminder(targetTime, currentTime, minutesBefore, windowMinutes = 5) {
    const reminderTime = new Date(targetTime.getTime() - minutesBefore * 60 * 1000);
    const windowStart = new Date(currentTime.getTime() - windowMinutes * 60 * 1000);
    const shouldSend = reminderTime > windowStart && reminderTime <= currentTime;
    
    // Detailed log for debugging time comparisons
    if (minutesBefore <= 120) { // Log only for recent reminders to avoid spam
         console.log(`
         - Checking: ${targetTime.toISOString()} (target) with ${minutesBefore} min reminder
         - Reminder Time: ${reminderTime.toISOString()}
         - Window Start:  ${windowStart.toISOString()}
         - Current Time:  ${currentTime.toISOString()}
         - Should Send? ---> ${shouldSend}
         `);
    }

    return shouldSend;
}

async function sendNotification(supabase, subscription, payload) {
    try {
        console.log(`Attempting to send notification: "${payload.title}"`);
        await webpush.sendNotification(subscription, JSON.stringify(payload));
        console.log("Notification sent successfully.");
    } catch (error) {
        if (error.statusCode === 410) {
            console.log('Subscription expired. Removing from DB.');
            const { error: deleteError } = await supabase
                .from('users')
                .update({ push_subscription: null })
                .eq('push_subscription', subscription);
            if (deleteError) {
                console.error('Failed to remove expired subscription:', deleteError);
            }
        } else {
            console.error('Error sending notification:', error);
        }
    }
}