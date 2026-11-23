#include <jni.h>
#include <unistd.h>
#include <android/log.h>
#include <pthread.h>
#include <cstdlib>
#include <cstring>
#include <vector>
#include <string>
#include "node.h"

static void* logger(void* pipeRead) {
    int fd = *static_cast<int*>(pipeRead); delete static_cast<int*>(pipeRead);
    char buffer[1024]; ssize_t length;
    while ((length = read(fd, buffer, sizeof(buffer) - 1)) > 0) {
        buffer[length] = 0; __android_log_write(ANDROID_LOG_INFO, "WhiteboardLocal", buffer);
    }
    close(fd); return nullptr;
}
extern "C" JNIEXPORT jint JNICALL
Java_com_whiteboardtv_app_LocalServerService_startNode(JNIEnv* env, jclass, jobjectArray arguments) {
    int fds[2];
    if (pipe(fds) == 0) {
        dup2(fds[1], STDOUT_FILENO); dup2(fds[1], STDERR_FILENO); close(fds[1]);
        pthread_t thread; pthread_create(&thread, nullptr, logger, new int(fds[0])); pthread_detach(thread);
    }
    const int count = env->GetArrayLength(arguments);
    std::vector<std::string> values; size_t size = 0;
    for (int i = 0; i < count; ++i) {
        jstring arg = static_cast<jstring>(env->GetObjectArrayElement(arguments, i));
        const char* value = env->GetStringUTFChars(arg, nullptr);
        values.emplace_back(value); size += values.back().size() + 1;
        env->ReleaseStringUTFChars(arg, value); env->DeleteLocalRef(arg);
    }
    // libuv requires contiguous argument storage.
    std::vector<char> buffer(size); std::vector<char*> argv(count + 1, nullptr); char* cursor = buffer.data();
    for (int i = 0; i < count; ++i) {
        argv[i] = cursor; memcpy(cursor, values[i].c_str(), values[i].size() + 1); cursor += values[i].size() + 1;
    }
    return node::Start(count, argv.data());
}
