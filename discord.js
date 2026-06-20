window.DiscordSDK = null;

(async () => {
    try {
        if (!window.DiscordSDK) {
            console.log("Discord SDK not available in this environment");
            return;
        }
    } catch (e) {
        console.log("Discord SDK disabled");
    }
})();