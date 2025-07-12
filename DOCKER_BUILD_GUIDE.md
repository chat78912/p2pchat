# Docker自动构建指南

由于权限限制，请手动在GitHub上创建以下文件：

## 1. 创建 `.github/workflows/docker-build.yml`

在GitHub仓库中创建此文件，内容如下：

```yaml
name: Build and Push Docker Image

on:
  push:
    branches: [ main ]
    paths:
      - 'server/**'
      - '.github/workflows/docker-build.yml'
  pull_request:
    branches: [ main ]
    paths:
      - 'server/**'
  workflow_dispatch:

env:
  DOCKER_IMAGE_NAME: p2pchat-server

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    
    steps:
    - name: Checkout code
      uses: actions/checkout@v4
    
    - name: Set up QEMU
      uses: docker/setup-qemu-action@v3
    
    - name: Set up Docker Buildx
      uses: docker/setup-buildx-action@v3
    
    - name: Login to Docker Hub
      uses: docker/login-action@v3
      with:
        username: ${{ secrets.DOCKER_USERNAME }}
        password: ${{ secrets.DOCKER_PASSWORD }}
    
    - name: Extract metadata
      id: meta
      uses: docker/metadata-action@v5
      with:
        images: |
          ${{ secrets.DOCKER_USERNAME }}/${{ env.DOCKER_IMAGE_NAME }}
        tags: |
          type=ref,event=branch
          type=ref,event=pr
          type=semver,pattern={{version}}
          type=semver,pattern={{major}}.{{minor}}
          type=raw,value=latest,enable={{is_default_branch}}
          type=sha,prefix={{branch}}-
    
    - name: Build and push Docker image
      uses: docker/build-push-action@v5
      with:
        context: ./server
        platforms: linux/amd64,linux/arm64
        push: true
        tags: ${{ steps.meta.outputs.tags }}
        labels: ${{ steps.meta.outputs.labels }}
        cache-from: type=gha
        cache-to: type=gha,mode=max
    
    - name: Image digest
      run: echo ${{ steps.docker_build.outputs.digest }}
```

## 2. 设置GitHub Secrets

在仓库设置中添加以下secrets：
- `DOCKER_USERNAME`: 你的Docker Hub用户名
- `DOCKER_PASSWORD`: 你的Docker Hub密码或访问令牌

## 3. 创建Docker Hub访问令牌

1. 登录 [Docker Hub](https://hub.docker.com/)
2. 进入 Account Settings -> Security
3. 创建新的Access Token
4. 使用此令牌作为 `DOCKER_PASSWORD`

## 4. 触发构建

- 推送代码到main分支会自动触发构建
- 或在Actions页面手动触发