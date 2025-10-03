// Import necessary libraries
const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');

// Handler function that Netlify will execute
exports.handler = async function(event, context) {
    console.log("--- Starting Notification Function ---");
    try {
        // --- 1. Initialize Supabase and Web Push ---
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );

        webpush.setVapidDetails(
            'mailto:your-email@example.com',
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
        const futureLimit = new Date(now.getTime() + 49 * 60 * 60 * 1000);

        // --- 3. Fetch all users with active push subscriptions ---
        const { data: users, error: usersError } = await supabase
            .from('users')
            .select('name, push_subscription')
            .not('push_subscription', 'is', null);

        if (usersError) throw new Error(`Error fetching users: ${usersError.message}`);
        if (!users || users.length === 0) {
            console.log("No users with subscriptions. Exiting.");
            return { statusCode: 200, body: "No users with subscriptions." };
        }
        console.log(`Found ${users.length} user(s) with subscriptions.`);

        // --- 4. NEW: Process Share/Unshare Notifications ---
        console.log("Checking for recent share status changes...");
        const { data: sharedTasks } = await supabase.from('tasks').select('title, owner, is_shared').gte('is_shared_updated_at', fiveMinutesAgo.toISOString());
        const { data: sharedEvents } = await supabase.from('events').select('title, owner, is_shared').gte('is_shared_updated_at', fiveMinutesAgo.toISOString());
        const recentlySharedItems = [
            ...(sharedTasks || []).map(t => ({...t, type: 'مهمة'})),
            ...(sharedEvents || []).map(e => ({...e, type: 'موعد'}))
        ];

        if (recentlySharedItems.length > 0) {
            console.log(`Found ${recentlySharedItems.length} recently shared/unshared item(s).`);
            for (const item of recentlySharedItems) {
                const actionText = item.is_shared ? 'بمشاركة' : 'بإلغاء مشاركة';
                const body = `قام ${item.owner} ${actionText} ${item.type}: "${item.title}"`;

                // Send to all *other* subscribed users
                const recipients = users.filter(u => u.name !== item.owner);
                for (const recipient of recipients) {
                     await sendNotification(supabase, recipient.push_subscription, {
                        appName: `إدارة المهام`, // General title for share notifications
                        body: body
                    }, recipient.name);
                }
            }
        } else {
            console.log("No recent share changes found.");
        }
        
        // --- 5. Process notifications for each user (reminders and summaries) ---
        for (const user of users) {
            try {
                console.log(`\nProcessing standard notifications for user: ${user.name}`);
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
                        .from('events').select('title, event_date').or(`owner.eq.${ownerName},is_shared.eq.true`)
                        .gte('event_date', todayStart.toISOString()).lte('event_date', todayEnd.toISOString())
                        .order('event_date', { ascending: true });
                    
                    if (todaysEvents && todaysEvents.length > 0) {
                        let body = `ملخص مواعيد اليوم (${todaysEvents.length}):\n`;
                        todaysEvents.forEach(event => {
                             const time = new Date(event.event_date).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Riyadh' });
                             body += `\n• ${time} - ${event.title}`;
                        });
                        await sendNotification(supabase, subscription, {
                            appName: `إدارة المهام لـ${ownerName}`,
                            body: body
                        }, ownerName);
                    } else {
                        await sendNotification(supabase, subscription, {
                            appName: `إدارة المهام لـ${ownerName}`,
                            body: `لا توجد مواعيد مجدولة لهذا اليوم.`
                        }, ownerName);
                    }
                }
                
                // Rule 2: On-track tasks summary at 8:00 AM
                if (currentHour === 8 && isWithinFirst5Minutes) {
                    console.log(`Running on-track tasks summary for ${user.name} at 8 AM.`);
                     const { data: onTrackTasks } = await supabase
                        .from('tasks').select('title').or(`owner.eq.${ownerName},is_shared.eq.true`)
                        .eq('status', 'تنفيذ').gte('due_datetime', now.toISOString());

                    if (onTrackTasks && onTrackTasks.length > 0) {
                         let body = `لديك ${onTrackTasks.length} مهام قيد التنفيذ:\n`;
                         onTrackTasks.forEach(task => {
                            body += `\n• ${task.title}`;
                         });
                         await sendNotification(supabase, subscription, {
                            appName: `إدارة المهام لـ${ownerName}`,
                            body: body
                        }, ownerName);
                    } else {
                        await sendNotification(supabase, subscription, {
                           appName: `إدارة المهام لـ${ownerName}`,
                           body: `لا توجد مهام قيد التنفيذ حالياً.`
                       }, ownerName);
                    }
                }

                // Rule 3: Overdue tasks summary at 9:00 AM
                if (currentHour === 9 && isWithinFirst5Minutes) {
                    console.log(`Running overdue tasks summary for ${user.name} at 9 AM.`);
                    const { data: overdueTasks } = await supabase
                        .from('tasks').select('title').or(`owner.eq.${ownerName},is_shared.eq.true`)
                        .eq('status', 'تنفيذ').lt('due_datetime', now.toISOString());

                    if (overdueTasks && overdueTasks.length > 0) {
                        let body = `لديك ${overdueTasks.length} مهام متأخرة:\n`;
                        overdueTasks.forEach(task => {
                            body += `\n• ${task.title}`;
                        });
                         await sendNotification(supabase, subscription, {
                            appName: `إدارة المهام لـ${ownerName}`,
                            body: body
                        }, ownerName);
                    } else {
                        await sendNotification(supabase, subscription, {
                            appName: `إدارة المهام لـ${ownerName}`,
                            body: `لا توجد لديك مهام متأخرة. أحسنت!`
                        }, ownerName);
                    }
                }

                // --- Time-sensitive Reminders (unchanged) ---
                
                // Rules 4 & 5: Event reminders
                const { data: upcomingEvents, error: eventsError } = await supabase
                    .from('events').select('title, event_date').or(`owner.eq.${ownerName},is_shared.eq.true`)
                    .gte('event_date', fiveMinutesAgo.toISOString()) 
                    .lte('event_date', futureLimit.toISOString()); 

                if (eventsError) throw new Error(`Events query error: ${eventsError.message}`);
                
                if (upcomingEvents && upcomingEvents.length > 0) {
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
                                await sendNotification(supabase, subscription, { appName: `إدارة المهام لـ${ownerName}`, body: rem.body }, ownerName);
                            }
                        }
                    }
                }
                
                // Rule 6: Planning task reminder
                const { data: planningTasks, error: planningError } = await supabase
                    .from('tasks').select('title, start_datetime').or(`owner.eq.${ownerName},is_shared.eq.true`)
                    .eq('status', 'تخطيط')
                    .gte('start_datetime', fiveMinutesAgo.toISOString())
                    .lte('start_datetime', futureLimit.toISOString());
                
                if(planningError) throw new Error(`Planning tasks query error: ${planningError.message}`);

                if (planningTasks && planningTasks.length > 0) {
                     for (const task of planningTasks) {
                        if (shouldSendReminder(new Date(task.start_datetime), now, 24 * 60)) {
                             await sendNotification(supabase, subscription, {
                                appName: `إدارة المهام لـ${ownerName}`,
                                body: `سيبدأ تنفيذ مهمة "${task.title}" غداً.`
                            }, ownerName);
                        }
                    }
                }
               
                // Rule 7: Execution task reminder
                const { data: executionTasks, error: executionError } = await supabase
                    .from('tasks').select('title, due_datetime').or(`owner.eq.${ownerName},is_shared.eq.true`)
                    .eq('status', 'تنفيذ')
                    .gte('due_datetime', fiveMinutesAgo.toISOString())
                    .lte('due_datetime', futureLimit.toISOString());
                
                if(executionError) throw new Error(`Execution tasks query error: ${executionError.message}`);

                 if (executionTasks && executionTasks.length > 0) {
                    for (const task of executionTasks) {
                        if (shouldSendReminder(new Date(task.due_datetime), now, 24 * 60)) {
                            await sendNotification(supabase, subscription, {
                                appName: `إدارة المهام لـ${ownerName}`,
                                body: `الوقت المحدد لمهمة "${task.title}" ينتهي غداً.`
                            }, ownerName);
                        }
                    }
                }
            } catch (userError) {
                console.error(`!!! ERROR processing user ${user.name}:`, userError.message);
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
    const shouldSend = reminderTime >= windowStart && reminderTime < currentTime; // Use >= to include the exact start of the window
    return shouldSend;
}


async function sendNotification(supabase, subscription, payload, userName) {
    try {
        const notificationPayload = {
            title: payload.appName,
            body: payload.body
        };
        console.log(`Attempting to send notification: "${notificationPayload.title}" to ${userName}`);
        await webpush.sendNotification(subscription, JSON.stringify(notificationPayload));
        console.log("Notification sent successfully.");
    } catch (error) {
        if (error.statusCode === 410) {
            console.log(`Subscription expired for user ${userName}. Removing from DB.`);
            const { error: deleteError } = await supabase
                .from('users')
                .update({ push_subscription: null })
                .eq('name', userName);
            if (deleteError) {
                console.error(`Failed to remove expired subscription for ${userName}:`, deleteError);
            }
        } else {
            console.error('Error sending notification:', error);
        }
    }
}
