#include <cstdio>
#include <cstring>

#include "test.h"

namespace testing
{
namespace
{
int         g_failures = 0;
int         g_checks   = 0;
bool        g_case_failed = false;
const char* g_fixture  = nullptr;
} // namespace

std::vector<Case>& Registry()
{
    static std::vector<Case> cases;
    return cases;
}

void Fail(const char* file, int line, const std::string& what)
{
    ++g_failures;
    g_case_failed = true;
    std::fprintf(stderr, "    FAIL %s:%d: %s\n", file, line, what.c_str());
}

void CountCheck() { ++g_checks; }

const char* FixturePath() { return g_fixture; }

} // namespace testing

int main(int argc, char** argv)
{
    const char* filter = nullptr;
    for(int i = 1; i < argc; ++i)
    {
        if(std::strcmp(argv[i], "--fixtures") == 0 && i + 1 < argc)
            testing::g_fixture = argv[++i];
        else
            filter = argv[i];
    }
    if(testing::g_fixture == nullptr)
    {
        std::fprintf(stderr, "usage: %s --fixtures <v1.json> [filter]\n",
                     argv[0]);
        return 2;
    }

    int ran = 0, failed_cases = 0;
    for(const auto& c : testing::Registry())
    {
        if(filter != nullptr && std::strstr(c.name, filter) == nullptr)
            continue;
        ++ran;
        testing::g_case_failed = false;
        try
        {
            c.body();
        }
        catch(const testing::Abort&)
        {
        }
        if(testing::g_case_failed)
        {
            ++failed_cases;
            std::fprintf(stderr, "  not ok - %s\n", c.name);
        }
        else
        {
            std::printf("  ok - %s\n", c.name);
        }
    }

    std::printf("%d tests, %d checks, %d failed tests, %d failed checks\n",
                ran, testing::g_checks, failed_cases, testing::g_failures);
    return failed_cases == 0 && ran > 0 ? 0 : 1;
}
