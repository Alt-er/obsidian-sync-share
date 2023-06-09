import MyPlugin from "main";
import { Notice, Plugin, TFile } from "obsidian";
import { request } from "request";


export const shareNote = async (plugin: MyPlugin, file: TFile) => {

    const { serverUrl, username, token } = plugin.settings;

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

        await request(`${serverUrl}/share/shareNote`, {
            method: 'POST',
            headers: {
                'username': username,
                'token': token
            },
            body: formData
        }).then(res => res.text()).then(url => {
            navigator.clipboard.writeText(url);
            new Notice("Note Share to Web. URL copied to clipboard.");
        })

    }

}

const findLinkedFiles = async (file: TFile, embeddedFiles: TFile[]) => {

    if (file.extension === "md") {
        const markdownContent = await file.vault.read(file);
        // 定义正则表达式匹配模式
        const regex = /\[.*?\]\((.*?)\)/g;

        let match;
        while ((match = regex.exec(markdownContent)) !== null) {
            const link = match[1];
            const nextFile = file.vault.getAbstractFileByPath(decodeURIComponent(link));
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