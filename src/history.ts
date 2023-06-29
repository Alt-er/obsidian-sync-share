import { App, Modal, TFile } from "obsidian";
import NoteSyncSharePlugin from "./main";
import { request } from "./request";



export class HistoryModal extends Modal {
    plugin: NoteSyncSharePlugin;
    file: TFile;
    page: number;

    constructor(app: App, plugin: NoteSyncSharePlugin, file: TFile) {
        super(app);
        this.plugin = plugin;
        this.file = file;
        this.page = 1;
    }

    async getFileHistory(filePath: string) {
        return await request(`${this.plugin.getServerUrl()}/history/fileHistory?file=${filePath}&page=${this.page}`, {
            method: 'GET',
            headers: {
                'username': this.plugin.settings.username,
                'token': this.plugin.settings.token
            },
        }).then(res => res.json());
    }

    async getFileContent(commitId: string, filePath: string) {
        return await request(`${this.plugin.getServerUrl()}/history/fileContent?commitId=${commitId}&file=${filePath}`, {
            method: 'GET',
            headers: {
                'username': this.plugin.settings.username,
                'token': this.plugin.settings.token
            },
        }).then(res => res.arrayBuffer());
    }

    async onOpen() {

        const { contentEl } = this;

        const title = contentEl.createDiv({ text: 'Remote History' });
        title.addClass("modal_title_warpper")

        const div = contentEl.createDiv();
        div.addClass("modal_content_warpper")


        // 添加列表内容
        const listEl = div.createEl('ul');

        const loadHistory = async () => {
            const historys: {
                author: string;
                commitId: string;
                message: string;
                path: string;
                time: string;
            }[] = await this.getFileHistory(this.file.path);

            // console.info(historys);

            historys.forEach(item => {
                const listItem = listEl.createEl('li');
                const a = listItem.createEl("a");
                a.textContent = item.author + ": " + item.message;
                a.onclick = async () => {
                    const bytes: ArrayBuffer = await this.getFileContent(item.commitId, item.path);
                    const tab = app.workspace.getLeaf("tab")
                    const { basename, extension } = this.file;
                    const fileName = item.message.replace(/[-\s:]/g, '');

                    let filePath = basename + "_" + fileName + "." + extension;
                    let index = 1;
                    while (app.vault.getAbstractFileByPath(filePath)) {
                        filePath = basename + "_" + fileName + "_" + index++ + "." + extension;
                    }
                    try {
                        const file = await app.vault.createBinary(filePath, bytes);
                        tab.openFile(file, { active: true });
                    } catch (e) {
                        // 如果文件名导致了其他的错误 则直接用当前时间当文件名
                        const file = await app.vault.createBinary(Date.now() + "." + extension, bytes);
                        tab.openFile(file, { active: true });
                    }
                    this.close()
                }
            });

            if (historys.length > 0) {
                const loadMoreElement = div.querySelector(".load_more");
                if (!loadMoreElement) {
                    const loadMore = div.createDiv({ text: "Load More" });
                    loadMore.addClass("load_more");
                    loadMore.onclick = async () => {
                        this.page++;
                        loadHistory();
                    }
                }
            } else {
                const loadMoreElement = div.querySelector(".load_more");
                if (loadMoreElement) {
                    loadMoreElement.remove()
                    const noMore = div.createDiv({ text: "No more" });
                    noMore.addClass("tips")
                } else {
                    const syncToLocalGit = this.plugin.settings.syncToLocalGit
                    div.createDiv({
                        text: "No Data"
                    }).addClass("tips");

                    if (!syncToLocalGit) {
                        div.createDiv({
                            text: "Please go to the settings screen to enable `Sync to server-side local git`"
                        }).addClass("tips");
                    }
                }
            }

        }

        loadHistory();
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
