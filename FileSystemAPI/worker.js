var root;
var fileHandle;
var tempFileHandle;
var testWriteFileHandle;

async function catchError(callback, ...theArgs) {
    try { await callback(...theArgs)}
    catch(e) { postMessage(e.message || e.toString())}
}

const CMD = {
    load: async function() {
        if (!checkFileHandle(fileHandle)) return;
        if (!(await verifyPermission(fileHandle, "read"))) return;
        
        const accessHandle = await tempFileHandle.createSyncAccessHandle();
        const file = await fileHandle.getFile();
        const readableStream = file.stream();
        const reader = readableStream.getReader({ mode: "byob"});
        let buffer = new ArrayBuffer(1024 * 1024 * 2);
        
        accessHandle.truncate(0);
        await readStream(reader);
        accessHandle.flush();
        accessHandle.close();
        
        function readStream(reader) {
            let offset = 0;
            let bytesReceived = 0;
            return reader
                .read(new Uint8Array(buffer))
                .then(function processText({ done, value }) {
                    if (done) {
                        postMessage(`load() complete. Total bytes: ${bytesReceived}`);
                        return;
                    }
                    accessHandle.write(value, { at: offset });
                    buffer = value.buffer;
                    offset += value.byteLength;
                    bytesReceived += value.byteLength;
                    if (!(offset & 0x1FFFFFF)) {
                        postMessage(`flush Total bytes: ${bytesReceived}`);
                        accessHandle.flush();
                    }
                    return reader
                        .read(new Uint8Array(buffer))
                        .then(processText);
                });
        }
    },
    save: async function() {
        if (!checkFileHandle(fileHandle)) return;
        if (!(await verifyPermission(fileHandle, "readwrite"))) return;
        
        let chunk;
        let position = 0;
        let chunkSize = 1024 * 1024 * 2;
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
            !(position & 0x1FFFFFF) && postMessage(`write Total bytes: ${position}`);
        }
        
        await writableStream.close();
        accessHandle.close();
        postMessage(`save() complete. Total bytes: ${position}`);
    },
    newFile: async function() {
        await this.truncate(0);
        fileHandle = undefined;
        postMessage("createNewFile")
    },
    openFile: async function(_fileHandle) {
        fileHandle = _fileHandle;
        postMessage(`openFile: ${fileHandle.name}`);
        await this.load();
    },
    saveFile: async function(_fileHandle) {
        fileHandle = _fileHandle;
        postMessage(`saveFile: ${fileHandle.name}`);
        await this.save();
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
    testRead: async function(bytes) {
        const accessHandle = await tempFileHandle.createSyncAccessHandle();
        postMessage(`testRead:`);
        const bufSizes = [4, 8, 16, 1024, 1 << 20];
        bytes = parseInt(bytes) || 1 << 23;
        bytes = Math.min(bytes, accessHandle.getSize());
        for (let i = 0; i < bufSizes.length; i++) {
            let offset = 0;
            const bufSize = bufSizes[i];
            const buffer = new DataView(new ArrayBuffer(bufSize));
            postMessage(`read ${bytes} bytes`);
            postMessage(`chunk is ${bufSize} bytes`);
            const t = new Date().getTime()
            while(offset < bytes) {
                accessHandle.read(buffer, { at: offset});
                offset += bufSize;
            }
            postMessage(`time: ${new Date().getTime() - t}`)
        }
        postMessage(`end`)
        accessHandle.flush();
        accessHandle.close();
    },
    testWrite: async function(bytes = 1 << 23) {
        const accessHandle = await testWriteFileHandle.createSyncAccessHandle();
        postMessage(`testWrite:`);
        const readBufferSize = 1 << 27;
        const readBuffer = new ArrayBuffer(readBufferSize);
        const writeSizes = [4, 8, 16, 1024, 1 << 20];
        bytes = parseInt(bytes) || 1 << 23;
        bytes = Math.min(bytes, readBufferSize);
        for (let i = 0; i < writeSizes.length; i++) {
            let offset = 0;
            const writeSize = writeSizes[i];
            postMessage(`write ${bytes} bytes`);
            postMessage(`chunk is ${writeSize} bytes`);
            const t = new Date().getTime()
            while(offset < bytes) {
                const u8 = new Uint8Array(readBuffer, offset, Math.min(writeSize, bytes - offset))
                accessHandle.write(u8, { at: offset});
                offset += writeSize;
            }
            accessHandle.flush();
            postMessage(`time: ${new Date().getTime() - t}`)
        }
        postMessage(`end`)
        accessHandle.flush();
        accessHandle.close();
    }
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
    let accessHandle = await tempFileHandle.createSyncAccessHandle();
    accessHandle.truncate(0);
    accessHandle.flush();
    accessHandle.close();
    testWriteFileHandle = await root.getFileHandle("testwrite", { create: true });
    accessHandle = await testWriteFileHandle.createSyncAccessHandle();
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