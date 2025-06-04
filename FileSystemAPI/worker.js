var root;
var fileHandle;
var tempFileHandle;

async function catchError(callback, ...theArgs) {
    try { await callback(...theArgs)}
    catch(e) { postMessage(e.message || e.toString())}
}

const CMD = {
    load: async function() {
        if (!checkFileHandle(fileHandle)) return;
        if (!(await verifyPermission(fileHandle, "read"))) return;
        
    },
    save: async function() {
        if (!checkFileHandle(fileHandle)) return;
        if (!(await verifyPermission(fileHandle, "readwrite"))) return;
        
        let chunk;
        let position = 0;
        let chunkSize = 1024 * 1024;
        const accessHandle = await tempFileHandle.createSyncAccessHandle();
        const writableStream = await fileHandle.createWritable();
        const size = accessHandle.getSize();
        
        await writableStream.truncate(0);
        while(size - position > 0) {
            chunkSize = Math.min(chunkSize, size - position);
            chunk = new DataView(new ArrayBuffer(chunkSize));
            accessHandle.read(chunk, { at: position});
            await writableStream.write(chunk);
            position += chunkSize;
        }
        
        await writableStream.close();
        accessHandle.close();
        postMessage(`save: ${fileHandle.name}`)
    },
    newFile: async function() {
        await this.truncate(0);
        fileHandle = undefined;
        postMessage("createNewFile")
    },
    openFile: async function(_fileHandle) {
        fileHandle = _fileHandle;
        postMessage(`openFile: ${fileHandle.name}`)
    },
    saveFile: async function(_fileHandle) {
        fileHandle = _fileHandle;
        await this.save();
        postMessage(`saveFile: ${fileHandle.name}`);
    },
    getSize: async function() {
        const accessHandle = await tempFileHandle.createSyncAccessHandle();
        const size = accessHandle.getSize();
        accessHandle.flush();
        accessHandle.close();
        postMessage(`fileSize: ${size}bytes`);
    },
    truncate: async function(size) {
        const accessHandle = await tempFileHandle.createSyncAccessHandle();
        const oldSize = accessHandle.getSize();
        accessHandle.truncate(size);
        const newSize = accessHandle.getSize();
        accessHandle.flush();
        accessHandle.close();
        postMessage(`truncate: ${newSize}bytes`);
    },
    seek: async function() {
    
    },
    read: async function(position, byteLength) {
        const accessHandle = await tempFileHandle.createSyncAccessHandle();
        const buffer = new DataView(new ArrayBuffer(byteLength));
        accessHandle.read(buffer, { at: position});
        accessHandle.flush();
        accessHandle.close();
        postMessage(new TextDecoder().decode(buffer));
    },
    write: async function(string, position) {
        const accessHandle = await tempFileHandle.createSyncAccessHandle();
        position === undefined && (position = accessHandle.getSize());
        accessHandle.write(new TextEncoder().encode(string), { at: position });
        accessHandle.flush();
        accessHandle.close();
        postMessage(`write: "${string}" position ${position}`);
    },
}

onmessage = async (e) => { await catchError(_onmessage, e) }

async function _onmessage(e) {
    let arr;
    const data = e.data;
    if(!Array.isArray(data) && typeof data !== "string") {
        return
    }
    if (typeof data === "string") {
        arr = data.split(/\s+/);
    }
    else {
        arr = data.slice(0);
    }
    
    const command = arr.shift();
    if (CMD[command]) await CMD[command](...arr);
    else postMessage(`No command "${command}" found`)
}

async function init() {
    root = await navigator.storage.getDirectory();
    tempFileHandle = await root.getFileHandle("cache", {create: true});
    const accessHandle = await tempFileHandle.createSyncAccessHandle();
    accessHandle.truncate(0);
    accessHandle.flush();
    accessHandle.close();
    postMessage("workerReady")
}

function checkFileHandle(fileHandle) {
    if (fileHandle && fileHandle.constructor.name == "FileSystemFileHandle") {
        return true;
    }
    else {
        postMessage(`no FileSystemFileHandle`);
        return false;
    }
}

async function verifyPermission(fileHandle, mode) {
    return new Promise((resolve) => {
        function fun(e) {
            const data = e.data;
            if (typeof data === "object") {
                const { command, result } = data;
                if (command === "verifyPermission") {
                    removeEventListener("message", fun);
                    !result && postMessage(`no ${mode} permission`);
                    resolve(result);
                }
            }
        }
        addEventListener("message", fun);
        postMessage(["verifyPermission", fileHandle, mode]);
    })
}


setTimeout(()=>catchError(init), 100)