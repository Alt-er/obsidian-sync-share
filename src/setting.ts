import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { request, setRequestConcurrentNum } from "src/request";
import NoteSyncSharePlugin from "./main";

export function isGitHttpUrl(url: string) {
    var httpUrlRegex = /^https?:\/\/[\w\.@:\/-]+\.git$/;
    return httpUrlRegex.test(url);
}


export const isValidServerUrl = (url: string, tips: boolean = false) => {
    const regex = /^https?:\/\/([\w.-]+)(:\d+)?$/;
    const valid = regex.test(url);
    if (!valid && tips) {
        new Notice("Invalid server URL. Please enter a valid URL.");
    }
    return valid;
};

export const isValidUsername = (username: string, tips: boolean = false) => {
    const regex = /^[a-zA-Z0-9_]{5,18}$/;
    const valid = regex.test(username);
    if (!valid && tips) {
        new Notice("Invalid username. Please enter a username with 5 to 18 alphanumeric characters or underscores.");
    }
    return valid;
};

export const isValidPassword = (password: string, tips: boolean = false) => {
    const regex = /^[A-Za-z0-9@#$%^&*_]{6,18}$/;
    const valid = regex.test(password);
    if (!valid && tips) {
        new Notice("Invalid password. Please enter a password with 6 to 18 alphanumeric characters or the following special characters: @, #, $, %, ^, &, *, _.");
    }
    return valid;
};


async function updateGitConfig(plugin: NoteSyncSharePlugin, gitConfig: {
    syncToLocalGit: boolean;
    maximumCommitFileSize: number;
    remoteGitAddress: string;
    remoteGitUsername: string;
    remoteGitAccessToken: string;
}) {
    if (!plugin.settings.token) {
        new Notice("Please login first")
        return;
    }
    await request(`${plugin.getServerUrl()}/user/updateGitConfig`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'username': plugin.settings.username,
            'token': plugin.settings.token
        },
        body: JSON.stringify(gitConfig)
    }).then(async res => {
        new Notice(await res.text());
    })
}

async function getGitConfig(plugin: NoteSyncSharePlugin,) {
    if (plugin.settings.serverUrl && plugin.settings.token) {
        await request(`${plugin.getServerUrl()}/user/getGitConfig`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'username': plugin.settings.username,
                'token': plugin.settings.token
            },
        }, true).then(async res => {
            const config = await res.json()
            plugin.settings = {
                ...plugin.settings,
                ...config
            }
        }).catch(c => { })
    }
}

export default class SettingTab extends PluginSettingTab {
    plugin: NoteSyncSharePlugin;

    constructor(app: App, plugin: NoteSyncSharePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {

        const { containerEl } = this;

        containerEl.empty();

        // containerEl.createEl('h1', { text: 'Notes Sync Share' });
        // containerEl.createEl('h2', { text: 'Basic Settings' });


        new Setting(containerEl)
            .setName('Server')
            .setDesc('It\'s a URL, enter your http service address')
            .addText(text => {
                const inputEl = text.inputEl;
                text.setPlaceholder('https://share.example.com')
                    .setValue(this.plugin.settings.serverUrl)
                    .onChange(async (value) => {
                        // if (!isValidServerUrl(value)) {
                        //     errorMessage.textContent = 'Please enter a valid URL';
                        //     errorMessage.style.display = 'block';
                        // } else {
                        //     errorMessage.style.display = 'none';
                        // }
                        this.plugin.settings.serverUrl = value;
                        await this.plugin.saveSettings();
                    })

                // return inputEl.parentElement?.appendChild(errorMessage);
            }).setClass("setting_equal_width_warpper")

        new Setting(containerEl)
            .setClass("flex-setting-item")
            .setName('User')
            .setDesc('Please enter your username and password, if it does not exist, it will be created automatically.')
            .addText(text => text
                .setPlaceholder('username')
                .setValue(this.plugin.settings.username)
                .onChange(async (value) => {
                    this.plugin.settings.username = value;
                    await this.plugin.saveSettings();
                }))

            .addText(text => {
                text.inputEl.setAttribute('type', 'password');
                text.setPlaceholder('password')
                    .setValue(this.plugin.settings.password)
                    .onChange(async (value) => {
                        this.plugin.settings.password = value;
                        await this.plugin.saveSettings();
                    })
            })
            .addButton(button =>
                button.setButtonText(this.plugin.settings.token ? "relogin" : "login")
                    .onClick(async e => {
                        this.plugin.login();
                        this.plugin.settings.token ? "relogin" : "login"
                    })
            )


        new Setting(containerEl).setName("Auto-run")
            .setDesc("Runs every once in a while and automatically synchronizes with the server")
            .addDropdown(dropdown =>
                dropdown.addOption("-1", "Unset")
                    .addOption("1", "Every 1 minutes")
                    .addOption("5", "Every 5 minutes")
                    .addOption("10", "Every 10 minutes")
                    .addOption("30", "Every 30 minutes")
                    .setValue(this.plugin.settings.autoRunInterval + "")
                    .onChange(async val => {
                        this.plugin.settings.autoRunInterval = parseInt(val);
                        await this.plugin.saveSettings();
                        this.plugin.registerAutoRun();
                    })
            )


        new Setting(containerEl).setName("Parallelism")
            .setDesc("Parallel number of simultaneous downloads and uploads")
            .addDropdown(dropdown =>
                dropdown
                    .addOption("1", "1")
                    .addOption("5", "5")
                    .addOption("10", "10(default)")
                    .addOption("15", "15")
                    .addOption("20", "20")
                    .setValue(this.plugin.settings.parallelism + "")
                    .onChange(async val => {
                        this.plugin.settings.parallelism = parseInt(val);
                        await this.plugin.saveSettings();
                        setRequestConcurrentNum(this.plugin.settings.parallelism);
                    })
            )



        new Setting(containerEl).setName("Show Notifications")
            .setDesc("When enabled, the plugin displays notifications on each successful sync to provide feedback. If you don't want to be disturbed by these notifications, you can turn this switch off.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showNotifications)
                .onChange(async v => {
                    this.plugin.settings.showNotifications = v;
                    await this.plugin.saveSettings();
                })
            );


        new Setting(containerEl).setName("Sync config directory")
            .setDesc("When turned on, the configuration directory (.obsidian) will be synchronized, and hidden files and node_modules directories will be skipped. This feature may cause unexpected problems, for example: the plug-in data of each device will be exactly the same, and some plug-ins may not want this to happen. Some plug-in data may need to be restarted after obsidian is synchronized to take effect. Please use it as needed!")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.syncConfigDir)
                .onChange(async v => {
                    this.plugin.settings.syncConfigDir = v;
                    await this.plugin.saveSettings();
                    this.plugin.registerObsidianConfigDirListen()
                })
            );

        // -----------------git config ---------------------



        containerEl.createEl('h2', { text: 'Git Configuration' });

        new Setting(containerEl).setName("Sync to server-side local git")
            .setDesc("Enable synchronization of note updates to the local Git repository on the server, You can view the history of file modifications after turning on")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.syncToLocalGit)
                .onChange(async v => {
                    this.plugin.settings.syncToLocalGit = v;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl).setName("Reject oversized commits")
            .setDesc("Reject commits to git that exceed the size of the file")
            .addDropdown(dropdown =>
                dropdown
                    .addOption("1", "1MB(default)")
                    .addOption("5", "5MB")
                    .addOption("10", "10MB")
                    .addOption("15", "15MB")
                    .addOption("20", "20MB")
                    .addOption("50", "50MB")
                    .addOption("100", "100MB")
                    .addOption("500", "500MB")
                    .addOption("1024", "1GB")
                    .addOption("2048", "2GB")
                    .addOption("10240", "10GB")
                    .setValue(this.plugin.settings.maximumCommitFileSize + "")
                    .onChange(async val => {
                        this.plugin.settings.maximumCommitFileSize = parseInt(val);
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl).setName("Sync to remote git")
            .setDesc("Remote git service address, skip push if not filled, Turning it on will force push the local git commit to the remote git service")
            .addText(text =>
                text
                    .setPlaceholder('https://git.example.com/your_repo.git')
                    .setValue(this.plugin.settings.remoteGitAddress)
                    .onChange(async v => {
                        this.plugin.settings.remoteGitAddress = v;
                        await this.plugin.saveSettings();
                    })
            ).setClass("setting_equal_width_warpper");

        new Setting(containerEl).setName("Username")
            .setDesc("Remote git repository username, Requires repository write access ")
            .addText(text =>
                text
                    .setPlaceholder('remote git repository username')
                    .setValue(this.plugin.settings.remoteGitUsername)
                    .onChange(async v => {
                        this.plugin.settings.remoteGitUsername = v;
                        await this.plugin.saveSettings();
                    })
            ).setClass("setting_equal_width_warpper");

        new Setting(containerEl).setName("AccessToken")
            .setDesc("Remote git repository accessToken, Requires repository write access ")
            .addText(text =>
                text
                    .setPlaceholder('remote git repository accessToken')
                    .setValue(this.plugin.settings.remoteGitAccessToken)
                    .onChange(async v => {
                        this.plugin.settings.remoteGitAccessToken = v;
                        await this.plugin.saveSettings();
                    })
                    .inputEl.setAttribute('type', 'password')
            ).setClass("setting_equal_width_warpper");


        new Setting(containerEl).addButton(button =>
            button.setButtonText("Upload git configuration")
                .onClick(e => {
                    const { syncToLocalGit, maximumCommitFileSize, remoteGitAddress, remoteGitUsername, remoteGitAccessToken } = this.plugin.settings;
                    if (remoteGitAddress && !isGitHttpUrl(remoteGitAddress)) {
                        new Notice("Invalid remote git address")
                        return;
                    }
                    updateGitConfig(this.plugin, { syncToLocalGit, maximumCommitFileSize, remoteGitAddress, remoteGitUsername, remoteGitAccessToken });
                }))

    }

    hide(): void {
        // 回滚没有保存的配置
        getGitConfig(this.plugin);
    }



}
