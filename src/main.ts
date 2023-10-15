import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TAbstractFile, TFile, TFolder, setIcon } from 'obsidian';
import * as localforage from "localforage";
import { enqueueTask } from 'src/TaskQueue';
import { request, setRequestConcurrentNum } from 'src/request';
import SettingTab, { isValidPassword, isValidServerUrl, isValidUsername } from 'src/setting';
import { ShareHistoryStore, ShareModal, shareNotes } from 'src/share';
import { HistoryModal } from './history';
export type LocalForage = typeof localforage;
// Remember to rename these classes and interfaces!

export interface NoteSyncSharePluginSettings {

	serverUrl: string;
	username: string;
	password: string;
	token: string;
	vaultId: number;
	autoRunInterval: number;
	parallelism: number;
	syncToLocalGit: boolean;
	maximumCommitFileSize: number;
	remoteGitAddress: string;
	remoteGitUsername: string;
	remoteGitAccessToken: string;
}

const DEFAULT_SETTINGS: NoteSyncSharePluginSettings = {
	serverUrl: "https://share.your_service.com",
	username: "",
	password: "",
	token: "",
	vaultId: 0,
	autoRunInterval: -1,
	parallelism: 10,
	syncToLocalGit: false,
	maximumCommitFileSize: 1,
	remoteGitAddress: "",
	remoteGitUsername: "",
	remoteGitAccessToken: "",
}


type DiffActionInfo = {
	uploadFiles: string[]
	downloadFiles: string[]
	deleteFiles: string[]
	deleteDeleteHistorys: string[]
	uploadDeleteHistorys: string[]
}
type Diff = {
	clientDiffActionInfo: DiffActionInfo
	serverDiffActionInfo: Pick<DiffActionInfo, 'deleteFiles' | 'deleteDeleteHistorys'>,
}


export default class NoteSyncSharePlugin extends Plugin {
	settings: NoteSyncSharePluginSettings;

	db: LocalForage

	shareHistoryStore: ShareHistoryStore

	listenDeleteEvent: boolean = true

	autoRunIntervalId: number

	syncButtonElement: HTMLElement

	getServerUrl() {
		const url = this.settings.serverUrl;
		if (!isValidServerUrl(url, true)) {
			throw new Error("Invalid server URL. Please enter a valid URL.")
		}
		return url + "/api";
	}

	async deleteFileOrFolder(file: TAbstractFile) {
		this.listenDeleteEvent = false;
		if (file instanceof TFolder) {
			await this.app.vault.delete(file, true);
			// console.log('delete folder', file)
		} else {
			await this.app.vault.delete(file);
			// console.log('delete file', file)
		}
		this.listenDeleteEvent = true;
	}

	registerAutoRun() {
		// 清理
		if (this.autoRunIntervalId) {
			window.clearInterval(this.autoRunIntervalId)
		}

		// 重新设置
		if (this.settings.autoRunInterval > 0) {
			this.autoRunIntervalId = this.registerInterval(window.setInterval(
				() => {
					this.syncButtonElement.click();
				}
				, this.settings.autoRunInterval * 60 * 1000));
		}
	}


	login() {
		if (isValidServerUrl(this.settings.serverUrl, true)
			&& isValidUsername(this.settings.username, true)
			&& isValidPassword(this.settings.password, true)) {
			// 尝试登录
			return request(`${this.getServerUrl()}/user/login`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					username: this.settings.username,
					password: this.settings.password,
				})
			}).then(res => res.text()).then(token => {
				if (token) {
					// console.log("token:", token)
					this.settings.token = token;
					this.saveSettings();
					new Notice("Login successful. ")
				} else {
					this.settings.token = "";
					this.saveSettings();
				}
			})
		}

	}
	async syncNotesByDiff(diff: Diff) {

		// 同步更新记录 下载 删除
		// 更新服务端需要删除和更新的删除记录
		// 这里要await等待删除完成后 再上传下载
		await request(`${this.getServerUrl()}/sync/syncDeleteHistoryAndFiles`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'username': this.settings.username,
				'token': this.settings.token
			},
			body: JSON.stringify({
				uploadDeleteHistorys: await Promise.all(diff.clientDiffActionInfo.uploadDeleteHistorys.map(async dh => {
					return dh + "\t" + await this.db.getItem(dh)
				})),
				deleteDeleteHistorys: diff.serverDiffActionInfo.deleteDeleteHistorys,
				deleteFiles: diff.serverDiffActionInfo.deleteFiles
			})
		}).then(response => response.text())
			.then(async data => {
				// 更新本地的删除记录
				diff.clientDiffActionInfo.deleteDeleteHistorys.forEach(dh => {
					this.db.removeItem(dh);
				})
				const sorted = diff.clientDiffActionInfo.deleteFiles.sort((a, b) => b.length - a.length);
				for (let i = 0; i < sorted.length; i++) {
					const path = sorted[i];
					const file = this.app.vault.getAbstractFileByPath(path);
					if (file) {
						if (file instanceof TFolder) {
							if (file.children.length === 0) {
								await this.deleteFileOrFolder(file)
							}
						} else {
							await this.deleteFileOrFolder(file)
						}
					}
				}

				// console.log('sync delete history successfully:', data);
			})




		// 上传
		const uploadFetchPromises = diff.clientDiffActionInfo.uploadFiles.map(async f => {
			const file = this.app.vault.getAbstractFileByPath(f);
			if (file) {
				const isDir = !(file instanceof TFile);
				const formData = new FormData();
				formData.append('path', file.path);
				if (isDir) {
					formData.append('isDir', "true");
					formData.append('mtime', "0");
				} else {
					formData.append('mtime', file.stat.mtime + "");
					const fileData = await this.app.vault.readBinary(file);
					formData.append('file', new Blob([fileData]), file.name);
					formData.append('isDir', "false");
				}

				// 发送请求到服务器
				await request(`${this.getServerUrl()}/sync/uploadFile`, {
					method: 'POST',
					headers: {
						'username': this.settings.username,
						'token': this.settings.token
					},
					body: formData
				})
					.then(response => response.text())
					.then(data => {
						// console.log('uploaded successfully:', data);
					})

			}
		})

		// 下载
		const downloadFetchPromises = diff.clientDiffActionInfo.downloadFiles.map(async f => {

			const formData = new FormData();
			formData.append('path', f);
			// 发送请求到服务器
			await request(`${this.getServerUrl()}/sync/downloadFile`, {
				method: 'POST',
				headers: {
					'username': this.settings.username,
					'token': this.settings.token
				},
				body: formData
			})
				.then(async response => {
					const buffer = await response.arrayBuffer();
					await enqueueTask(async () => {
						const isDir = response.headers.get("isDir");
						if (isDir === "true") {
							const file = this.app.vault.getAbstractFileByPath(f);
							if (!file) {
								await this.app.vault.createFolder(f);
							}
						} else {
							const file = this.app.vault.getAbstractFileByPath(f);
							const mtime = response.headers.get("mtime") || "0";
							if (!file) {
								const arr = f.split("/");
								const parentDir = arr.slice(0, arr.length - 1).join("/");
								if (parentDir && !this.app.vault.getAbstractFileByPath(parentDir)) {
									await this.app.vault.createFolder(parentDir);
								}
								await this.app.vault.createBinary(f, buffer, { mtime: parseInt(mtime) })

							} else if (file instanceof TFile) {
								this.app.vault.modifyBinary(file, buffer, { mtime: parseInt(mtime) });
							} else if (file instanceof TFolder) {
								// 下载的时候如果发现本应该是文件的变成了文件夹
								console.warn("Discovery of files and folders with the same name");
								if (file.children.length == 0) {
									await this.deleteFileOrFolder(file);
									await this.app.vault.createBinary(f, buffer, { mtime: parseInt(mtime) })
								}
								// this.app.vault.modifyBinary(file, await response.arrayBuffer(), { mtime: parseInt(mtime) });
							}
						}
					})

				})
		})

		await Promise.all(uploadFetchPromises.concat(downloadFetchPromises))

		// 告诉服务端结束
		// 发送请求到服务器
		await request(`${this.getServerUrl()}/sync/syncCompleted`, {
			method: 'POST',
			headers: {
				'username': this.settings.username,
				'token': this.settings.token
			},
		}).then(response => response.text())
			.then(data => {
				new Notice("Synchronized notes completed");
				// console.log('unlock: ', data);
			})

	}

	async syncNotes() {

		new Notice("Start syncing notes");

		const files = this.app.vault.getAllLoadedFiles();

		type fileAndDeleteInfo = [string, string][];
		const fileInfos: fileAndDeleteInfo = [];
		const deleteHistory: fileAndDeleteInfo = [];
		files.forEach(f => {
			if (f.path === "/" || f.path === "\\") {
				return;
			}
			if (f instanceof TFile) {
				fileInfos.push([f.path, f.stat.mtime + ""]);
			} else {
				fileInfos.push([f.path, "0"]);
			}
		});
		await this.db.iterate((v, k) => {
			deleteHistory.push([k, v + ""])
		})

		// console.log({
		// 	fileInfos,
		// 	deleteHistory
		// })


		await request(`${this.getServerUrl()}/sync/diff`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'username': this.settings.username,
				'token': this.settings.token
			},
			body: JSON.stringify({
				fileInfos,
				deleteHistory
			})
		})
			.then(response =>
				response.json()
			)
			.then((data: Diff) =>
				this.syncNotesByDiff(data)
			)

	}

	async onload() {
		await this.loadSettings();
		if (this.settings.vaultId == 0) {
			this.settings.vaultId = Date.now();
			this.saveSettings();
		}

		// 删除记录
		this.db = localforage.createInstance({
			name: 'obsidian-sync-share-' + this.settings.vaultId,
			storeName: 'delete_history',
		})


		// 分享记录
		const shareHistoryDb = localforage.createInstance({
			name: 'obsidian-sync-share-' + this.settings.vaultId,
			storeName: 'share_history',
		})

		this.shareHistoryStore = new ShareHistoryStore(shareHistoryDb);

		// 设置并发数
		setRequestConcurrentNum(this.settings.parallelism);

		this.app.vault.on("delete", async (fileOrFolder) => {
			if (this.listenDeleteEvent) {
				// console.log("delete", fileOrFolder)
				this.db.setItem(fileOrFolder.path, Date.now());
			}
		})

		this.app.vault.on("rename", async (fileOrFolder, oldPath) => {
			// console.log("rename", fileOrFolder, oldPath)
			this.db.setItem(oldPath, Date.now());
		})


		// This creates an icon in the left ribbon.
		// refresh-ccw  rotate-ccw


		const ribbonIconEl = this.addRibbonIcon('refresh-ccw', 'Notes Sync', async (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			if (ribbonIconEl.querySelector(".lucide-rotate-ccw")) {
				new Notice("Synchronization in progress")
				return;
			}
			const start = Date.now()
			setIcon(ribbonIconEl, "rotate-ccw");
			try {
				await this.syncNotes();
			} catch (e) {
				console.error(e);
			}
			if (Date.now() - start < 1000) {
				setTimeout(() => { setIcon(ribbonIconEl, "refresh-ccw") }, 1000)
			} else {
				setIcon(ribbonIconEl, "refresh-ccw");
			}
		});
		// Perform additional things with the ribbon
		ribbonIconEl.addClass('rotate-icon');

		this.syncButtonElement = ribbonIconEl;

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		// const statusBarItemEl = this.addStatusBarItem();
		// statusBarItemEl.setText('Status Bar Text');

		// This adds a simple command that can be triggered anywhere
		// this.addCommand({
		// 	id: 'open-sample-modal-simple',
		// 	name: 'Open sample modal (simple)',
		// 	callback: () => {
		// 		new SampleModal(this.app).open();
		// 	}
		// });
		// This adds an editor command that can perform some operation on the current editor instance
		// this.addCommand({
		// 	id: 'sample-editor-command',
		// 	name: 'Sample editor command',
		// 	editorCallback: (editor: Editor, view: MarkdownView) => {
		// 		console.log(editor.getSelection());
		// 		editor.replaceSelection('Sample Editor Command');
		// 	}
		// });
		// This adds a complex command that can check whether the current state of the app allows execution of the command
		// this.addCommand({
		// 	id: 'open-sample-modal-complex',
		// 	name: 'Open sample modal (complex)',
		// 	checkCallback: (checking: boolean) => {
		// 		// Conditions to check
		// 		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		// 		if (markdownView) {
		// 			// If checking is true, we're simply "checking" if the command can be run.
		// 			// If checking is false, then we want to actually perform the operation.
		// 			if (!checking) {
		// 				new SampleModal(this.app).open();
		// 			}

		// 			// This command will only show up in Command Palette when the check function returns true
		// 			return true;
		// 		}
		// 	}
		// });

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		// this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
		// 	console.log('click', evt);
		// });



		this.registerFileMenuEvent();


		// 注册自动运行
		this.registerAutoRun();

		// const appConfigStr = await app.vault.adapter.read(`${app.vault.configDir}/app.json`)
		// const appConfig = JSON.parse(appConfigStr);

	}


	registerFileMenuEvent() {
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (file instanceof TFile) {
					menu.addSeparator();
					if (file.extension === "md") {
						const shareLink = this.shareHistoryStore.getShareHistory(file.path);
						if (shareLink) {
							menu
								.addItem(item => item.setTitle("Copy share URL")
									.onClick(e => {
										navigator.clipboard.writeText(shareLink);
										new Notice("URL copied to clipboard.");
									}))
								.addItem(item => item.setTitle("Remove from web")
									.onClick(e => {
										request(`${this.getServerUrl()}/share/delete?shareLinkId=${shareLink.split("/").pop()}`, {
											method: 'POST',
											headers: {
												'Content-Type': 'application/json',
												'username': this.settings.username,
												'token': this.settings.token
											}
										}).then(() => {
											this.shareHistoryStore.removeShareHistory(file.path);
										})

									}))
						} else {
							menu.addItem(item => item
								.setTitle("Share to web")
								.setIcon('up-chevron-glyph')
								.onClick(async () => {
									// const url = await shareNotes(this, file);
									// if (url) {
									// 	this.shareHistoryStore.addShareHistory(file.path, url);
									// }


									new ShareModal(this.app, this, file).open();
								}))
						}
					}
					menu.addItem(item => item
						.setTitle("Remote History")
						.setIcon('up-chevron-glyph')
						.onClick(async () => {
							new HistoryModal(this.app, this, file).open();
						}))

					menu.addSeparator();
				}

			})
		);
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
