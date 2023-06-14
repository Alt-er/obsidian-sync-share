import { Notice, Plugin, TFile } from "obsidian";
import { request } from "src/request";
import * as path from 'path-browserify'
import NoteSyncSharePlugin from "./main";

export const shareNotes = async (plugin: NoteSyncSharePlugin, file: TFile) => {

    const { username, token } = plugin.settings;
    const serverUrl = plugin.getServerUrl();
    if (file.extension === "md") {
        const title = file.basename;

        const formData = new FormData();
        formData.append('mainPath', file.path);
        formData.append('title', title);
        const fileData = await plugin.app.vault.readBinary(file);
        formData.append(file.path, new Blob([fileData]), file.name);

        // 找出关联的笔记
        // 查找匹配的文件
        const embeddedFiles: TFile[] = [];
        await findLinkedFiles(file, embeddedFiles);

        console.info("embeddedFiles", embeddedFiles);

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
        const regex = /\[.*?\]\((.*?)\)/g;

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