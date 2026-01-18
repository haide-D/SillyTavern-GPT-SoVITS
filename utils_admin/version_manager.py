import json
import os
import requests
from typing import Dict, Optional
from packaging import version
import shutil
import zipfile
import tempfile
import subprocess


class VersionManager:
    """版本管理工具类"""
    
    GITHUB_REPO = "haide-D/SillyTavern-GPT-SoVITS"
    GITHUB_API_URL = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
    REQUEST_TIMEOUT = 30  # 30秒超时
    
    def __init__(self, base_dir: str = None):
        """
        初始化版本管理器
        
        Args:
            base_dir: 项目根目录,默认为当前文件的上两级目录
        """
        if base_dir is None:
            # 获取当前文件所在目录的上两级目录(项目根目录)
            current_file = os.path.abspath(__file__)
            self.base_dir = os.path.dirname(os.path.dirname(current_file))
        else:
            self.base_dir = base_dir
        
        self.manifest_path = os.path.join(self.base_dir, "manifest.json")
    
    def get_current_version(self) -> Optional[str]:
        """
        从 manifest.json 读取当前版本号
        
        Returns:
            版本号字符串,如 "1.2.1",如果读取失败返回 None
        """
        try:
            if not os.path.exists(self.manifest_path):
                return None
            
            with open(self.manifest_path, 'r', encoding='utf-8') as f:
                manifest = json.load(f)
                return manifest.get('version')
        except Exception as e:
            print(f"读取当前版本失败: {e}")
            return None
    
    def get_latest_release(self) -> Optional[Dict]:
        """
        从 GitHub API 获取最新 release 信息
        
        Returns:
            包含 release 信息的字典,如果失败返回 None
            字典包含: tag_name, name, body, html_url, zipball_url
        """
        try:
            response = requests.get(
                self.GITHUB_API_URL,
                timeout=self.REQUEST_TIMEOUT,
                headers={'Accept': 'application/vnd.github.v3+json'}
            )
            
            if response.status_code == 200:
                data = response.json()
                return {
                    'tag_name': data.get('tag_name', ''),
                    'name': data.get('name', ''),
                    'body': data.get('body', ''),
                    'html_url': data.get('html_url', ''),
                    'zipball_url': data.get('zipball_url', ''),
                    'published_at': data.get('published_at', '')
                }
            else:
                print(f"GitHub API 返回错误: {response.status_code}")
                return None
                
        except requests.Timeout:
            print("GitHub API 请求超时")
            return None
        except Exception as e:
            print(f"获取最新版本失败: {e}")
            return None
    
    def compare_versions(self, current: str, latest: str) -> int:
        """
        比较两个版本号
        
        Args:
            current: 当前版本号
            latest: 最新版本号
        
        Returns:
            -1: current < latest (有新版本)
             0: current == latest (版本相同)
             1: current > latest (当前版本更新)
        """
        try:
            # 移除可能的 'v' 前缀
            current = current.lstrip('v')
            latest = latest.lstrip('v')
            
            current_ver = version.parse(current)
            latest_ver = version.parse(latest)
            
            if current_ver < latest_ver:
                return -1
            elif current_ver == latest_ver:
                return 0
            else:
                return 1
        except Exception as e:
            print(f"版本比较失败: {e}")
            return 0
    
    def check_for_updates(self) -> Dict:
        """
        检查是否有可用更新
        
        Returns:
            包含检查结果的字典:
            {
                'success': bool,
                'has_update': bool,
                'current_version': str,
                'latest_version': str,
                'release_url': str,
                'release_notes': str,
                'error': str (如果有错误)
            }
        """
        result = {
            'success': False,
            'has_update': False,
            'current_version': None,
            'latest_version': None,
            'release_url': None,
            'release_notes': None,
            'is_git_repo': False
        }
        
        # 首先获取当前版本(确保在所有返回路径中都有版本号)
        current_version = self.get_current_version()
        result['current_version'] = current_version
        
        # 检查是否是 Git 仓库
        git_dir = os.path.join(self.base_dir, '.git')
        if os.path.exists(git_dir):
            result['is_git_repo'] = True
            # Git 仓库也继续检查远程版本,不直接返回
        
        # 如果无法读取版本号,返回错误但仍包含 current_version (可能为 None)
        if not current_version:
            result['error'] = '无法读取当前版本号'
            return result
        
        # 获取最新版本(Git 仓库用户也需要看到远程版本)
        latest_release = self.get_latest_release()
        if not latest_release:
            # 如果是 Git 仓库且无法获取 Release,仍然标记为成功
            # 因为 Git 用户可以通过 git pull 更新
            if result['is_git_repo']:
                result['success'] = True
                result['message'] = 'Git 仓库模式,无法从 GitHub 获取版本信息,但可以使用 git pull 更新'
                return result
            else:
                result['error'] = '无法获取最新版本信息(可能是网络超时或 GitHub API 限制)'
                return result
        
        latest_version = latest_release['tag_name'].lstrip('v')
        result['latest_version'] = latest_version
        result['release_url'] = latest_release['html_url']
        result['release_notes'] = latest_release['body']
        result['success'] = True
        
        # 比较版本
        comparison = self.compare_versions(current_version, latest_version)
        result['has_update'] = (comparison == -1)
        
        return result
    
    def git_pull_update(self, progress_callback=None) -> Dict:
        """
        使用 git pull 更新 Git 仓库
        
        Args:
            progress_callback: 进度回调函数,接收 (current, total, message) 参数
        
        Returns:
            包含更新结果的字典:
            {
                'success': bool,
                'message': str,
                'error': str (如果有错误),
                'branch': str (当前分支名)
            }
        """
        result = {'success': False}
        
        try:
            if progress_callback:
                progress_callback(1, 5, '检查 Git 环境...')
            
            # 检查 git 是否安装
            try:
                subprocess.run(
                    ['git', '--version'],
                    capture_output=True,
                    timeout=5,
                    cwd=self.base_dir
                )
            except (subprocess.TimeoutExpired, FileNotFoundError):
                result['error'] = 'Git 未安装或无法访问,请手动更新'
                return result
            
            # 获取当前分支名
            branch_result = subprocess.run(
                ['git', 'rev-parse', '--abbrev-ref', 'HEAD'],
                capture_output=True,
                text=True,
                timeout=5,
                cwd=self.base_dir
            )
            
            if branch_result.returncode == 0:
                current_branch = branch_result.stdout.strip()
                result['branch'] = current_branch
            else:
                result['error'] = '无法获取当前分支信息'
                return result
            
            
            if progress_callback:
                progress_callback(2, 5, f'检查仓库状态 ({current_branch})...')
            
            # 先尝试清理应该被 gitignore 但仍在 Git 跟踪中的文件
            # 这样可以避免老用户因为之前提交了 data/ 等文件而无法更新
            try:
                # 移除 Git 缓存中应该被忽略的文件,但保留工作区文件
                subprocess.run(
                    ['git', 'rm', '-r', '--cached', 'data/'],
                    capture_output=True,
                    timeout=10,
                    cwd=self.base_dir
                )
                # 如果成功移除,自动提交这个清理操作
                subprocess.run(
                    ['git', 'commit', '-m', 'chore: 清理不应跟踪的用户数据文件'],
                    capture_output=True,
                    timeout=10,
                    cwd=self.base_dir
                )
            except:
                # 如果清理失败(比如文件本来就不在跟踪中),忽略错误继续
                pass
            
            # 检查是否有未提交的更改
            status_result = subprocess.run(
                ['git', 'status', '--porcelain'],
                capture_output=True,
                text=True,
                timeout=10,
                cwd=self.base_dir
            )
            
            # 自动暂存所有本地更改(包括未跟踪的文件)
            # 这样用户不需要手动处理,更新会自动进行
            stash_needed = False
            if status_result.stdout.strip():
                try:
                    # 暂存所有更改,包括未跟踪的文件
                    stash_result = subprocess.run(
                        ['git', 'stash', 'push', '-u', '-m', 'Auto-stash before update'],
                        capture_output=True,
                        text=True,
                        timeout=10,
                        cwd=self.base_dir
                    )
                    if stash_result.returncode == 0:
                        stash_needed = True
                except Exception as e:
                    result['error'] = f'暂存本地更改失败: {str(e)}'
                    return result
            
            if progress_callback:
                progress_callback(3, 5, '正在获取远程更新...')
            
            # 先执行 git fetch 获取远程更新
            fetch_result = subprocess.run(
                ['git', 'fetch'],
                capture_output=True,
                text=True,
                timeout=60,
                cwd=self.base_dir
            )
            
            if fetch_result.returncode != 0:
                result['error'] = f'获取远程更新失败: {fetch_result.stderr}'
                return result
            
            if progress_callback:
                progress_callback(4, 5, f'正在拉取 {current_branch} 分支...')
            
            # 执行 git pull
            pull_result = subprocess.run(
                ['git', 'pull'],
                capture_output=True,
                text=True,
                timeout=60,
                cwd=self.base_dir
            )
            
            if pull_result.returncode != 0:
                result['error'] = f'Git pull 失败: {pull_result.stderr}'
                return result
            
            if progress_callback:
                progress_callback(5, 5, '更新完成!')
            
            # 如果之前暂存了用户的修改,尝试恢复
            if stash_needed:
                try:
                    pop_result = subprocess.run(
                        ['git', 'stash', 'pop'],
                        capture_output=True,
                        text=True,
                        timeout=10,
                        cwd=self.base_dir
                    )
                    # 即使恢复失败也不影响更新成功的状态
                    # 只是在消息中提示用户
                    if pop_result.returncode != 0:
                        result['stash_conflict'] = True
                        result['stash_message'] = '更新成功,但恢复本地修改时发生冲突,请手动运行 git stash pop 处理'
                except:
                    pass
            
            # 检查是否有实际更新
            output = pull_result.stdout.strip()
            if 'Already up to date' in output or '已经是最新' in output:
                result['success'] = True
                result['message'] = f'分支 {current_branch} 已是最新版本'
                result['no_update'] = True
            else:
                result['success'] = True
                result['message'] = f'成功更新分支 {current_branch}!即将自动重启服务'
                result['updated'] = True
                result['should_restart'] = True  # 标记需要重启
                # 提取更新的文件数量信息
                if 'file' in output or 'changed' in output:
                    result['update_details'] = output
            
        except subprocess.TimeoutExpired:
            result['error'] = 'Git 操作超时,请检查网络连接'
        except Exception as e:
            result['error'] = f'更新失败: {str(e)}'
        
        return result
    
    
    def download_and_update(self, progress_callback=None) -> Dict:
        """
        下载并安装最新版本
        
        Args:
            progress_callback: 进度回调函数,接收 (current, total, message) 参数
        
        Returns:
            包含更新结果的字典:
            {
                'success': bool,
                'message': str,
                'error': str (如果有错误)
            }
        """
        result = {'success': False}
        
        # 检查是否是 Git 仓库,如果是则使用 git pull 更新
        git_dir = os.path.join(self.base_dir, '.git')
        if os.path.exists(git_dir):
            return self.git_pull_update(progress_callback)
        
        try:
            # 获取最新版本信息
            latest_release = self.get_latest_release()
            if not latest_release:
                result['error'] = '无法获取最新版本信息'
                return result
            
            zipball_url = latest_release['zipball_url']
            
            if progress_callback:
                progress_callback(1, 5, '正在下载最新版本...')
            
            # 下载 ZIP 文件
            response = requests.get(zipball_url, timeout=300, stream=True)
            if response.status_code != 200:
                result['error'] = f'下载失败: HTTP {response.status_code}'
                return result
            
            # 保存到临时文件
            with tempfile.NamedTemporaryFile(delete=False, suffix='.zip') as tmp_file:
                tmp_path = tmp_file.name
                for chunk in response.iter_content(chunk_size=8192):
                    tmp_file.write(chunk)
            
            if progress_callback:
                progress_callback(2, 5, '正在备份当前版本...')
            
            # 创建备份
            backup_dir = os.path.join(self.base_dir, '.backup')
            if os.path.exists(backup_dir):
                shutil.rmtree(backup_dir)
            os.makedirs(backup_dir, exist_ok=True)
            
            # 备份关键文件
            files_to_backup = ['manifest.json', 'system_settings.json']
            for file in files_to_backup:
                src = os.path.join(self.base_dir, file)
                if os.path.exists(src):
                    shutil.copy2(src, backup_dir)
            
            # 备份 data 目录
            data_dir = os.path.join(self.base_dir, 'data')
            if os.path.exists(data_dir):
                shutil.copytree(data_dir, os.path.join(backup_dir, 'data'))
            
            if progress_callback:
                progress_callback(3, 5, '正在解压新版本...')
            
            # 解压到临时目录
            with tempfile.TemporaryDirectory() as extract_dir:
                with zipfile.ZipFile(tmp_path, 'r') as zip_ref:
                    zip_ref.extractall(extract_dir)
                
                # GitHub zipball 会创建一个子目录,找到它
                extracted_items = os.listdir(extract_dir)
                if len(extracted_items) == 1:
                    source_dir = os.path.join(extract_dir, extracted_items[0])
                else:
                    source_dir = extract_dir
                
                if progress_callback:
                    progress_callback(4, 5, '正在更新文件...')
                
                # 需要保留的目录和文件
                preserve_items = ['data', 'system_settings.json', '.backup']
                
                # 复制新文件(跳过需要保留的项)
                for item in os.listdir(source_dir):
                    if item in preserve_items:
                        continue
                    
                    src = os.path.join(source_dir, item)
                    dst = os.path.join(self.base_dir, item)
                    
                    # 删除旧文件/目录
                    if os.path.exists(dst):
                        if os.path.isdir(dst):
                            shutil.rmtree(dst)
                        else:
                            os.remove(dst)
                    
                    # 复制新文件/目录
                    if os.path.isdir(src):
                        shutil.copytree(src, dst)
                    else:
                        shutil.copy2(src, dst)
            
            # 清理临时文件
            os.remove(tmp_path)
            
            if progress_callback:
                progress_callback(5, 5, '更新完成!')
            
            result['success'] = True
            result['message'] = f'成功更新到版本 {latest_release["tag_name"]}!即将自动重启服务'
            result['should_restart'] = True  # 标记需要重启
            
        except Exception as e:
            result['error'] = f'更新失败: {str(e)}'
            
            # 尝试恢复备份
            backup_dir = os.path.join(self.base_dir, '.backup')
            if os.path.exists(backup_dir):
                try:
                    for item in os.listdir(backup_dir):
                        src = os.path.join(backup_dir, item)
                        dst = os.path.join(self.base_dir, item)
                        if os.path.isdir(src):
                            if os.path.exists(dst):
                                shutil.rmtree(dst)
                            shutil.copytree(src, dst)
                        else:
                            shutil.copy2(src, dst)
                    result['error'] += ' (已恢复备份)'
                except:
                    result['error'] += ' (恢复备份失败,请手动检查)'
        
        return result
