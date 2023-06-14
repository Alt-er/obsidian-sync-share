import MyPlugin from "main";
import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { setRequestConcurrentNum } from "src/request";


export const isValidServerUrl = (url: string, tips: boolean = false) => {
    const regex = /^(https?:\/\/)?([a-zA-Z0-9-]+\.)?[a-zA-Z0-9-]+(\.[a-zA-Z]{2,})?(:\d+)?$/;
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



export default class SettingTab extends PluginSettingTab {
    plugin: MyPlugin;

    constructor(app: App, plugin: MyPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        // containerEl.createEl('h2', { text: 'Notes sync share plugin.' });

        new Setting(containerEl)
            .setName('Server')
            .setDesc('It\'s a URL , enter your http service address')
            .addText(text => {
                const inputEl = text.inputEl;
                const errorMessage = document.createElement('div');
                errorMessage.className = 'setting-item-description error-message';
                errorMessage.style.color = 'red';
                errorMessage.style.display = 'none';
                text.setPlaceholder('https://share.example.com')
                    .setValue(this.plugin.settings.serverUrl)
                    .onChange(async (value) => {
                        if (!isValidServerUrl(value)) {
                            errorMessage.textContent = 'Please enter a valid URL';
                            errorMessage.style.display = 'block';
                        } else {
                            errorMessage.style.display = 'none';
                        }
                        this.plugin.settings.serverUrl = value;
                        await this.plugin.saveSettings();
                    })

                return inputEl.parentElement?.appendChild(errorMessage);
            }
            )

        new Setting(containerEl)

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
    }

}
