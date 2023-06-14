// 定义任务队列
const taskQueue: (() => Promise<void>)[] = [];
// 标志位，表示是否有任务正在执行
let isTaskExecuting = false;

// 添加任务到任务队列
function enqueueTask(task: () => Promise<void>): Promise<void> {
    const taskPromise = new Promise<void>((resolve, reject) => {
        const taskWithCompletion = async () => {
            try {
                await task();
                resolve();
            } catch (error) {
                reject(error);
            }
        };

        taskQueue.push(taskWithCompletion);
        processTaskQueue();
    });

    return taskPromise;
}

// 处理任务队列中的任务
async function processTaskQueue() {
    // 如果有任务正在执行或任务队列为空，则直接返回
    if (isTaskExecuting || taskQueue.length === 0) {
        return;
    }

    // 设置标志位，表示有任务正在执行
    isTaskExecuting = true;

    const task = taskQueue.shift();
    try {
        // 执行任务
        await task!();
    } catch (error) {
        console.error('Error executing task:', error);
    }

    // 设置标志位为false，表示没有任务正在执行
    isTaskExecuting = false;

    // 检查任务队列中是否还有等待执行的任务
    if (taskQueue.length > 0) {
        // 递归调用，处理下一个任务
        processTaskQueue();
    }
}
export { enqueueTask };

// // 示例使用
// function asyncTask(message: string): Promise<void> {
//     return new Promise<void>((resolve) => {
//         setTimeout(() => {
//             console.log(message);
//             resolve();
//         }, 1000);
//     });
// }

// // 添加任务到任务队列并等待执行完成
// enqueueTask(async () => {
//     await asyncTask('Task 1');
// }).then(() => {
//     console.log('Task 1 completed.');
// });

// enqueueTask(async () => {
//     await asyncTask('Task 2');
// }).then(() => {
//     console.log('Task 2 completed.');
// });

// enqueueTask(async () => {
//     await asyncTask('Task 3');
// }).then(() => {
//     console.log('Task 3 completed.');
// });
