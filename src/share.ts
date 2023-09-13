import { App, Modal, Notice, Platform, Plugin, Setting, TFile, getIcon } from "obsidian";
import { request } from "src/request";
import * as path from 'path-browserify'
import NoteSyncSharePlugin from "./main";

export const shareNotes = async (plugin: NoteSyncSharePlugin, file: TFile, expirationDate: number, link: string | null, headerPosition: string) => {

    const { username, token } = plugin.settings;
    const serverUrl = plugin.getServerUrl();
    if (file.extension === "md") {
        const title = file.basename;

        const formData = new FormData();
        formData.append('mainPath', file.path);
        formData.append('title', title);
        formData.append('expirationDate', expirationDate + "");
        if (link) {
            const linkId = link.split("?")[0].split("/").pop() as string;
            formData.append('shareLinkId', linkId);
        }
        formData.append('headerPosition', headerPosition);

        const fileData = await plugin.app.vault.readBinary(file);
        formData.append(file.path, new Blob([fileData]), file.name);

        // 找出关联的笔记
        // 查找匹配的文件
        const embeddedFiles: TFile[] = [];
        await findLinkedFiles(file, embeddedFiles);

        // console.info("embeddedFiles", embeddedFiles);

        await Promise.all(embeddedFiles.map(async file => {
            const fileData = await plugin.app.vault.readBinary(file);
            formData.append(file.path, new Blob([fileData]), file.name);
        }))

        return await request(`${serverUrl}/share/shareNote`, {
            method: 'POST',
            headers: {
                'username': username,
                'token': token
            },
            body: formData
        }).then(res => res.text()).then(url => {
            navigator.clipboard.writeText(plugin.settings.serverUrl + url);
            new Notice("Notes Share to Web. URL copied to clipboard.");
            return plugin.settings.serverUrl + url;
        })

    }

}

const findAttachmentByLink = (file: TFile, link: string) => {

    // 如果是一个远程链接,则直接跳过
    if (link.startsWith("http://") || link.startsWith("https://")) {
        return null;
    }


    // 1. 先绝对路径取一次
    // 2. 取不到当相对路径取一次
    // 3. 取不到按照文件名取一次 广度优先 , 需要先判断是不是一个文件名
    const abs = file.vault.getAbstractFileByPath(link);
    // 绝对路径找到了文件
    if (abs && abs instanceof TFile) {
        return abs
    }

    // 相对路径查找
    let parentPath = file.parent?.path;
    if (!parentPath || parentPath === "/") {
        parentPath = "";
    }
    const rel = file.vault.getAbstractFileByPath(path.join(parentPath, link));
    // 相对路径找到了文件
    if (rel && rel instanceof TFile) {
        return rel
    }

    if (!link.contains("/")) {
        // 文件名查找
        const fileByFileName = file.vault.getAllLoadedFiles().find(f =>
            f instanceof TFile && f.name == link
        )
        if (fileByFileName) {
            // 按照文件名找到了文件
            return fileByFileName
        }
    }

    return null;


    // const abs = file.vault.getAbstractFileByPath(link);

}

const findLinkedFiles = async (file: TFile, embeddedFiles: TFile[]) => {

    if (file.extension === "md") {
        const markdownContent = await file.vault.read(file);
        // 定义正则表达式匹配模式
        let regex = /\[.*?\]\((.*)\)/g;

        let match;
        while ((match = regex.exec(markdownContent)) !== null) {
            const link = match[1];

            const nextFile = findAttachmentByLink(file, decodeURIComponent(link));
            if (nextFile && nextFile instanceof TFile) {
                // 检查一下存过了没有
                if (embeddedFiles.find(tempFile => tempFile.path === nextFile.path)) {
                    // 之前存过则跳过
                    continue;
                }
                // 存起来
                embeddedFiles.push(nextFile);
                // 如果还是个md文件则继续找
                await findLinkedFiles(nextFile, embeddedFiles);
            }
        }
    }

}




export class ShareHistoryStore {

    shareHistory: LocalForage

    shareHistoryInMemory: Map<string, string> = new Map()

    constructor(db: LocalForage) {
        this.shareHistory = db;
        db.iterate((v, k) => {
            this.shareHistoryInMemory.set(k, v + "");
        })
    }

    async addShareHistory(path: string, url: string) {
        this.shareHistoryInMemory.set(path, url);
        await this.shareHistory.setItem(path, url);
    }

    async removeShareHistory(path: string) {
        this.shareHistoryInMemory.delete(path);
        await this.shareHistory.removeItem(path);
    }

    getShareHistory(path: string) {
        return this.shareHistoryInMemory.get(path);
    }
}




export class ShareModal extends Modal {
    plugin: NoteSyncSharePlugin;
    file: TFile;
    expirationType: "Unset" | "Minutes" | "Hours" | "Days"
    expirationValue: number
    headerPosition: 'static' | 'sticky' = 'static'

    constructor(app: App, plugin: NoteSyncSharePlugin, file: TFile) {
        super(app);
        this.plugin = plugin;
        this.file = file;
        this.expirationType = "Unset";
        this.expirationValue = 0;
    }

    async getShareHistory(filePath: string) {
        return await request(`${this.plugin.getServerUrl()}/share/shareHistory?path=${filePath}`, {
            method: 'GET',
            headers: {
                'username': this.plugin.settings.username,
                'token': this.plugin.settings.token
            },
        }).then(res => res.json());
    }

    async deleteShareHistory(shareLink: string) {
        return await request(`${this.plugin.getServerUrl()}/share/delete?shareLinkId=${shareLink.split("?")[0].split("/").pop()}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'username': this.plugin.settings.username,
                'token': this.plugin.settings.token
            }
        })
    }


    async onOpen() {

        const { contentEl } = this;

        const title = contentEl.createDiv({ text: 'Share History' });
        title.addClass("modal_title_warpper")

        new Setting(contentEl)
            .setName('Expiration date')
            .setDesc('Set an expiration date, after which the notes will be blocked from access')
            .addDropdown(dropdown =>
                dropdown.addOption("Unset", "Unset")
                    .addOption("Minutes", "Minutes")
                    .addOption("Hours", "Hours")
                    .addOption("Days", "Days")
                    .setValue(this.expirationType)
                    .onChange(async val => {
                        this.expirationType = val as any;
                    })
            )
            .addText(text => text
                .setPlaceholder('Please enter a number')
                .setValue(this.expirationValue + "")
                .onChange(async (value) => {
                    var regex = /^[1-9][0-9]*$/;
                    let num = value;
                    if (!regex.test(num)) {
                        num = num.replace(/[^1-9]/g, '');
                        text.setValue(num);
                    }
                    if (parseInt(num) > 10000) {
                        num = "10000";
                        text.setValue(num);
                    }
                    this.expirationValue = parseInt(num);
                }))

        new Setting(contentEl)
            .setName('Header position')
            .setDesc('Setting a fixed pattern for the header of the sharing page')
            .addDropdown(dropdown =>
                dropdown.addOption("static", "Default")
                    .addOption("sticky", "Sticky")
                    .setValue(this.headerPosition)
                    .onChange(async val => {
                        this.headerPosition = val as any;
                    })
            )


        new Setting(contentEl)
            .addButton(button => {
                button.buttonEl.style.width = "100%"
                button.setButtonText("Share & Copy")
                    .onClick(async e => {
                        // 计算过期时间 默认0 未设置
                        let expirationDate = 0;
                        if (this.expirationType === "Minutes" && this.expirationValue > 0) {
                            expirationDate = Date.now() + (1000 * 60 * this.expirationValue)
                        } else if (this.expirationType === "Hours" && this.expirationValue > 0) {
                            expirationDate = Date.now() + (1000 * 60 * 60 * this.expirationValue)
                        } else if (this.expirationType === "Days" && this.expirationValue > 0) {
                            expirationDate = Date.now() + (1000 * 60 * 60 * 24 * this.expirationValue);
                        }
                        await shareNotes(this.plugin, this.file, expirationDate, null, this.headerPosition);
                        loadHistory();
                    })
            })

        new Setting(contentEl)
        const div = contentEl.createDiv();
        div.addClass("modal_content_warpper")
        // 添加列表内容
        const listEl = div.createEl('ul');

        const loadHistory = async () => {
            listEl.empty();

            const shareHistory: { uuid: string, expirationDate: string }[] = await this.getShareHistory(this.file.path);

            shareHistory.forEach(h => {
                const listItem = listEl.createEl('li');
                listItem.addClass("share_history_record_warpper");

                const replace = getIcon("replace");
                if (replace) {
                    const span = listItem.createSpan();
                    span.appendChild(replace);
                    span.setAttribute("title", "Overwrite the latest note content into this link")
                    replace.onclick = async () => {
                        await this.deleteShareHistory(h.uuid);
                        // 计算过期时间 默认0 未设置
                        let expirationDate = 0;
                        if (this.expirationType === "Minutes" && this.expirationValue > 0) {
                            expirationDate = Date.now() + (1000 * 60 * this.expirationValue)
                        } else if (this.expirationType === "Hours" && this.expirationValue > 0) {
                            expirationDate = Date.now() + (1000 * 60 * 60 * this.expirationValue)
                        } else if (this.expirationType === "Days" && this.expirationValue > 0) {
                            expirationDate = Date.now() + (1000 * 60 * 60 * 24 * this.expirationValue);
                        }
                        await shareNotes(this.plugin, this.file, expirationDate, h.uuid, this.headerPosition);
                        //shareLink.split("?")[0].split("/").pop()
                        loadHistory();
                        new Notice("Completion of overwriting note content");
                    }
                }

                const a = listItem.createEl("a");
                a.textContent = `Expiration Date: ${h.expirationDate}`;
                a.href = this.plugin.settings.serverUrl + h.uuid;
                a.onclick = () => {
                    navigator.clipboard.writeText(this.plugin.settings.serverUrl + h.uuid);
                    new Notice("URL copied to clipboard.");
                }



                const trash = getIcon("trash-2");
                const copy = getIcon("copy");

                if (trash) {
                    const span = listItem.createSpan();
                    span.appendChild(trash);
                    span.setAttribute("title", "Delete this sharing record")
                    trash.onclick = async () => {
                        await this.deleteShareHistory(h.uuid);
                        loadHistory();
                        new Notice("Share has been deleted");
                    }
                }

                if (copy) {
                    const span = listItem.createSpan();
                    span.appendChild(copy);
                    span.setAttribute("title", "Copy the link to this shared record")
                    copy.onclick = () => {
                        navigator.clipboard.writeText(this.plugin.settings.serverUrl + h.uuid);
                        new Notice("URL copied to clipboard.");
                    }
                }

            })
        }

        loadHistory();
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}