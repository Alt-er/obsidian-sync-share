import { Notice } from "obsidian";

export async function request(input: RequestInfo | URL, init?: RequestInit | undefined) {
    return fetch(input, init)
        .then(response => {
            if (!response.ok) {
                return Promise.reject(response);
            }
            return response;
        }).catch(async (response: Response | Error) => {
            if (response instanceof Error) {
                new Notice(response.message);
            } else {
                new Notice(await response.text());
            }
            return Promise.reject(response);
        });
}