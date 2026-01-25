"""
验证 phone_call.enabled 总开关功能

测试场景:
1. phone_call.enabled = false - 所有功能应该被禁用
2. phone_call.enabled = true, auto_generation.enabled = false - 手动功能可用,自动功能禁用
3. phone_call.enabled = true, auto_generation.enabled = true - 所有功能可用
"""

import requests
import json

BASE_URL = "http://127.0.0.1:3000"

# 测试的 API 端点
TEST_ENDPOINTS = {
    "手动生成": [
        ("POST", "/phone_call/build_prompt", {"char_name": "测试角色", "context": []}),
        ("POST", "/phone_call/test_llm", {"api_url": "http://test", "api_key": "test", "model": "test"}),
        ("GET", "/phone_call/emotions/测试角色", None),
    ],
    "自动生成": [
        ("POST", "/phone_call/webhook/message", {
            "chat_branch": "test", 
            "speakers": ["测试角色"], 
            "current_floor": 3, 
            "context": [],
            "context_fingerprint": "test"
        }),
    ],
    "查询": [
        ("GET", "/phone_call/auto/latest/测试角色", None),
        ("GET", "/phone_call/auto/history/测试角色", None),
    ]
}

def test_api(method, endpoint, data=None):
    """测试单个 API"""
    url = f"{BASE_URL}{endpoint}"
    try:
        if method == "GET":
            response = requests.get(url, timeout=5)
        else:
            response = requests.post(url, json=data, timeout=5)
        
        return {
            "status_code": response.status_code,
            "success": response.status_code not in [403, 500],
            "message": response.json() if response.status_code != 403 else response.text
        }
    except Exception as e:
        return {
            "status_code": None,
            "success": False,
            "message": str(e)
        }

def run_tests(scenario_name):
    """运行所有测试"""
    print(f"\n{'='*60}")
    print(f"测试场景: {scenario_name}")
    print(f"{'='*60}\n")
    
    for category, endpoints in TEST_ENDPOINTS.items():
        print(f"\n{category}:")
        for method, endpoint, data in endpoints:
            result = test_api(method, endpoint, data)
            status = "✅" if result["success"] else "❌"
            print(f"  {status} {method} {endpoint}")
            print(f"     状态码: {result['status_code']}")
            if result["status_code"] == 403:
                print(f"     ✓ 正确返回 403 (功能已禁用)")

if __name__ == "__main__":
    print("\n" + "="*60)
    print("phone_call.enabled 总开关验证测试")
    print("="*60)
    
    print("\n请按照以下步骤手动测试:")
    print("\n1️⃣  设置 phone_call.enabled = false")
    print("   预期: 所有 API 返回 403")
    input("   完成设置后按回车继续...")
    run_tests("phone_call.enabled = false")
    
    print("\n\n2️⃣  设置 phone_call.enabled = true, auto_generation.enabled = false")
    print("   预期: 手动功能可用,自动功能通过 ConversationMonitor 被禁用")
    input("   完成设置后按回车继续...")
    run_tests("phone_call.enabled = true, auto_generation.enabled = false")
    
    print("\n\n3️⃣  设置 phone_call.enabled = true, auto_generation.enabled = true")
    print("   预期: 所有功能可用")
    input("   完成设置后按回车继续...")
    run_tests("phone_call.enabled = true, auto_generation.enabled = true")
    
    print("\n\n" + "="*60)
    print("测试完成!")
    print("="*60)
