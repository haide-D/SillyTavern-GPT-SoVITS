import os
import json
from typing import List, Dict, Any
from pathlib import Path

class ModelManager:
    """模型管理工具类"""
    
    def __init__(self, base_dir: str):
        self.base_dir = base_dir
    
    def scan_models(self) -> List[Dict[str, Any]]:
        """扫描所有模型"""
        if not os.path.exists(self.base_dir):
            return []
        
        models = []
        for item in os.listdir(self.base_dir):
            model_path = os.path.join(self.base_dir, item)
            if os.path.isdir(model_path):
                model_info = self._analyze_model(item, model_path)
                models.append(model_info)
        
        return models
    
    def _analyze_model(self, name: str, path: str) -> Dict[str, Any]:
        """分析单个模型"""
        ref_audio_dir = os.path.join(path, "reference_audios")
        
        # 通过后缀匹配查找权重文件
        gpt_weight = None
        sovits_weight = None
        
        if os.path.exists(path):
            for file in os.listdir(path):
                if file.endswith('.ckpt'):
                    gpt_weight = os.path.join(path, file)
                elif file.endswith('.pth'):
                    sovits_weight = os.path.join(path, file)
        
        # 检查文件完整性
        has_gpt = gpt_weight is not None and os.path.exists(gpt_weight)
        has_sovits = sovits_weight is not None and os.path.exists(sovits_weight)
        has_ref_dir = os.path.exists(ref_audio_dir)
        
        # 统计参考音频
        audio_stats = self._count_reference_audios(ref_audio_dir) if has_ref_dir else {}
        
        return {
            "name": name,
            "path": path,
            "valid": has_gpt and has_sovits and has_ref_dir,
            "files": {
                "gpt_weights": has_gpt,
                "sovits_weights": has_sovits,
                "reference_audios": has_ref_dir
            },
            "audio_stats": audio_stats
        }
    
    def _count_reference_audios(self, ref_dir: str) -> Dict[str, Any]:
        """统计参考音频"""
        if not os.path.exists(ref_dir):
            return {"total": 0, "by_language": {}, "by_emotion": {}}
        
        total = 0
        by_language = {}
        by_emotion = {}
        
        # 检查是否是多语言模式
        subdirs = [d for d in os.listdir(ref_dir) if os.path.isdir(os.path.join(ref_dir, d))]
        is_multilang = any(lang in subdirs for lang in ["Chinese", "Japanese", "English"])
        
        if is_multilang:
            # 多语言模式
            for lang in subdirs:
                lang_path = os.path.join(ref_dir, lang)
                emotions_path = os.path.join(lang_path, "emotions")
                
                if os.path.exists(emotions_path):
                    audios = self._list_audio_files(emotions_path)
                    by_language[lang] = len(audios)
                    total += len(audios)
                    
                    # 统计情感
                    for audio in audios:
                        emotion = self._extract_emotion(audio)
                        by_emotion[emotion] = by_emotion.get(emotion, 0) + 1
        else:
            # 简单模式
            audios = self._list_audio_files(ref_dir)
            total = len(audios)
            by_language["default"] = total
            
            for audio in audios:
                emotion = self._extract_emotion(audio)
                by_emotion[emotion] = by_emotion.get(emotion, 0) + 1
        
        return {
            "total": total,
            "by_language": by_language,
            "by_emotion": by_emotion
        }
    
    def _list_audio_files(self, directory: str) -> List[str]:
        """列出目录中的音频文件"""
        audio_extensions = ['.wav', '.mp3', '.ogg', '.flac']
        audios = []
        
        if not os.path.exists(directory):
            return audios
        
        for file in os.listdir(directory):
            if any(file.lower().endswith(ext) for ext in audio_extensions):
                audios.append(file)
        
        return audios
    
    def _extract_emotion(self, filename: str) -> str:
        """从文件名提取情感标签"""
        # 格式: emotion_prompt.wav
        name_without_ext = os.path.splitext(filename)[0]
        if '_' in name_without_ext:
            return name_without_ext.split('_')[0]
        return "default"
    
    def get_reference_audios(self, model_name: str) -> List[Dict[str, Any]]:
        """获取指定模型的参考音频列表"""
        model_path = os.path.join(self.base_dir, model_name)
        ref_dir = os.path.join(model_path, "reference_audios")
        
        if not os.path.exists(ref_dir):
            return []
        
        audios = []
        
        # 递归遍历所有音频文件
        for root, dirs, files in os.walk(ref_dir):
            for file in files:
                if any(file.lower().endswith(ext) for ext in ['.wav', '.mp3', '.ogg', '.flac']):
                    full_path = os.path.join(root, file)
                    rel_path = os.path.relpath(full_path, ref_dir)
                    
                    # 解析路径结构
                    parts = rel_path.split(os.sep)
                    language = "default"
                    emotion = self._extract_emotion(file)
                    
                    if len(parts) >= 2 and parts[0] in ["Chinese", "Japanese", "English"]:
                        language = parts[0]
                    
                    audios.append({
                        "filename": file,
                        "path": full_path,
                        "relative_path": rel_path,
                        "language": language,
                        "emotion": emotion,
                        "size": os.path.getsize(full_path)
                    })
        
        return audios
    
    def create_model_structure(self, model_name: str) -> Dict[str, Any]:
        """为新模型创建标准目录结构"""
        model_path = os.path.join(self.base_dir, model_name)
        
        if os.path.exists(model_path):
            return {
                "success": False,
                "error": f"模型 '{model_name}' 已存在"
            }
        
        try:
            # 创建主目录
            os.makedirs(model_path, exist_ok=True)
            
            # 创建多语言参考音频目录结构
            ref_dir = os.path.join(model_path, "reference_audios")
            for lang in ["Chinese", "Japanese", "English"]:
                emotions_dir = os.path.join(ref_dir, lang, "emotions")
                os.makedirs(emotions_dir, exist_ok=True)
            
            return {
                "success": True,
                "path": model_path
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
    
    def delete_audio(self, model_name: str, relative_path: str) -> Dict[str, Any]:
        """删除参考音频"""
        model_path = os.path.join(self.base_dir, model_name)
        ref_dir = os.path.join(model_path, "reference_audios")
        audio_path = os.path.join(ref_dir, relative_path)
        
        if not os.path.exists(audio_path):
            return {
                "success": False,
                "error": "文件不存在"
            }
        
        try:
            os.remove(audio_path)
            return {
                "success": True
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
    
    def _validate_path(self, path: str) -> bool:
        """验证路径安全性,防止路径遍历攻击"""
        try:
            # 规范化路径
            normalized = os.path.normpath(path)
            base_normalized = os.path.normpath(self.base_dir)
            
            # 确保路径在 base_dir 范围内
            if not normalized.startswith(base_normalized):
                return False
            
            # 检查是否包含路径遍历字符
            if ".." in path or path.startswith("/") or path.startswith("\\"):
                return False
            
            return True
        except Exception:
            return False
    
    def _validate_filename(self, filename: str) -> bool:
        """验证文件名合法性,只禁止文件系统非法字符"""
        # Windows 文件系统不允许的字符
        illegal_chars = ['/', '\\', ':', '*', '?', '"', '<', '>', '|']
        
        # 检查是否包含非法字符
        for char in illegal_chars:
            if char in filename:
                return False
        
        # 文件名不能为空或只包含空格
        if not filename or filename.strip() == "":
            return False
        
        # 文件名不能以点或空格结尾 (Windows 限制)
        if filename.endswith('.') or filename.endswith(' '):
            return False
        
        return True
    
    def rename_audio(self, model_name: str, relative_path: str, new_filename: str) -> Dict[str, Any]:
        """重命名参考音频文件"""
        model_path = os.path.join(self.base_dir, model_name)
        ref_dir = os.path.join(model_path, "reference_audios")
        old_path = os.path.join(ref_dir, relative_path)
        
        # 验证旧文件路径
        if not self._validate_path(old_path):
            return {
                "success": False,
                "error": "非法的文件路径"
            }
        
        if not os.path.exists(old_path):
            return {
                "success": False,
                "error": "文件不存在"
            }
        
        # 验证新文件名
        if not self._validate_filename(new_filename):
            return {
                "success": False,
                "error": "文件名包含非法字符或格式不正确"
            }
        
        # 构建新路径 (保持在同一目录下)
        old_dir = os.path.dirname(old_path)
        new_path = os.path.join(old_dir, new_filename)
        
        # 验证新文件路径
        if not self._validate_path(new_path):
            return {
                "success": False,
                "error": "非法的目标路径"
            }
        
        # 检查新文件名是否已存在
        if os.path.exists(new_path) and new_path != old_path:
            return {
                "success": False,
                "error": "目标文件名已存在"
            }
        
        try:
            os.rename(old_path, new_path)
            
            # 计算新的相对路径
            new_relative_path = os.path.relpath(new_path, ref_dir)
            
            return {
                "success": True,
                "old_path": relative_path,
                "new_path": new_relative_path,
                "new_filename": new_filename
            }
        except Exception as e:
            return {
                "success": False,
                "error": f"重命名失败: {str(e)}"
            }
    
    def batch_update_emotion(self, model_name: str, old_emotion: str, new_emotion: str) -> Dict[str, Any]:
        """批量修改指定情感前缀的所有音频文件"""
        # 验证情感标签
        if not old_emotion or not new_emotion:
            return {
                "success": False,
                "error": "情感标签不能为空"
            }
        
        # 验证情感标签不包含非法字符
        if not self._validate_filename(old_emotion) or not self._validate_filename(new_emotion):
            return {
                "success": False,
                "error": "情感标签包含非法字符"
            }
        
        model_path = os.path.join(self.base_dir, model_name)
        ref_dir = os.path.join(model_path, "reference_audios")
        
        if not os.path.exists(ref_dir):
            return {
                "success": False,
                "error": "参考音频目录不存在"
            }
        
        updated_files = []
        error_files = []
        
        # 递归遍历所有音频文件
        for root, dirs, files in os.walk(ref_dir):
            for file in files:
                # 检查是否是音频文件且匹配旧情感前缀
                if any(file.lower().endswith(ext) for ext in ['.wav', '.mp3', '.ogg', '.flac']):
                    name_without_ext = os.path.splitext(file)[0]
                    
                    # 检查是否以 "old_emotion_" 开头
                    if name_without_ext.startswith(f"{old_emotion}_"):
                        old_file_path = os.path.join(root, file)
                        
                        # 构建新文件名
                        ext = os.path.splitext(file)[1]
                        new_name = name_without_ext.replace(f"{old_emotion}_", f"{new_emotion}_", 1)
                        new_filename = new_name + ext
                        new_file_path = os.path.join(root, new_filename)
                        
                        # 验证路径安全性
                        if not self._validate_path(old_file_path) or not self._validate_path(new_file_path):
                            error_files.append(file)
                            continue
                        
                        # 检查新文件名是否已存在
                        if os.path.exists(new_file_path):
                            error_files.append(f"{file} (目标已存在)")
                            continue
                        
                        try:
                            os.rename(old_file_path, new_file_path)
                            updated_files.append({
                                "old": file,
                                "new": new_filename
                            })
                        except Exception as e:
                            error_files.append(f"{file} ({str(e)})")
        
        return {
            "success": True,
            "updated_count": len(updated_files),
            "files": updated_files,
            "errors": error_files if error_files else None
        }

