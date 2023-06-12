import { Notice } from "obsidian";

// export async function request(input: RequestInfo | URL, init?: RequestInit | undefined) {
//     return fetch(input, init)
//         .then(response => {
//             if (!response.ok) {
//                 return Promise.reject(response);
//             }
//             return response;
//         }).catch(async (response: Response | Error) => {
//             if (response instanceof Error) {
//                 new Notice(response.message);
//             } else {
//                 new Notice(await response.text());
//             }
//             return Promise.reject(response);
//         });
// }


class ConcurrentFetch {
    private maxConcurrency: number;
    private activeCount: number;
    private queue: (() => Promise<any>)[];

    constructor(maxConcurrency: number) {
        this.maxConcurrency = maxConcurrency;
        this.activeCount = 0;
        this.queue = [];
    }

    private async processQueue() {
        if (this.activeCount >= this.maxConcurrency) return;

        const task = this.queue.shift();
        if (task) {
            this.activeCount++;
            await task();
            this.activeCount--;
            this.processQueue();
        }
    }

    async fetch(input: RequestInfo | URL, init?: RequestInit | undefined): Promise<Response> {
        return new Promise((resolve, reject) => {
            const task = async () => {
                try {
                    const response = await fetch(input, init);
                    resolve(response);
                    if (response.ok) {
                        resolve(response);
                    } else {
                        reject(response)
                    }
                } catch (error) {
                    reject(error);
                }
            };

            this.queue.push(task);
            this.processQueue();
        });
    }
}

// 创建一个并发数为 10 的实例
let concurrentFetch: ConcurrentFetch = new ConcurrentFetch(10);

export const setRequestConcurrentNum = (concurrentNum: number) => {
    concurrentFetch = new ConcurrentFetch(concurrentNum);
}

export async function request(input: RequestInfo | URL, init?: RequestInit | undefined) {
    return concurrentFetch.fetch(input, init).catch(async (response: Response | Error) => {
        if (response instanceof Error) {
            new Notice(response.message);
        } else {
            new Notice(await response.text());
        }
        return Promise.reject(response);
    });
}



// for (let i = 0; i < 100; i++) {
//     concurrentFetch.fetch("http://localhost:3000/api/user/test?a=" + i, {
//         method: "Post"
//     }).then(async res => {
//         console.log("完成:" + await res.text())
//     })
// }
