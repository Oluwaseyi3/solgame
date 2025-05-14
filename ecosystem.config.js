module.exports = {
    apps: [
        {
            name: 'perprug',
            script: 'PerpRug.js',
            watch: false,
            max_memory_restart: '1G',
            exec_mode: 'fork',
            instances: 1,
            autorestart: true,
            time: true,
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
            env: {
                NODE_ENV: 'production',
            },
            // Output logs to files for better tracking
            output: './logs/perprug-out.log',
            error: './logs/perprug-error.log',
            // Merge logs
            merge_logs: true,
            // Custom script to run when app crashes
            post_update: [
                'echo "App updated, restarting"',
                'npm install'
            ],
            // Arguments to pass to the script
            args: [],
            // Max time (ms) app needs to start before being considered crashed
            wait_ready: true,
            listen_timeout: 5000,
            // Restart the app if it uses more than 500MB
            max_memory_restart: '500M'
        }
    ]
};