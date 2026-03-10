import { useNavigate } from 'react-router-dom'
import { ArrowLeft, FileText, Shield, AlertCircle } from 'lucide-react'
import { useI18n } from '../i18n/I18nContext'

export default function TosPage() {
  const navigate = useNavigate()
  const { t, language } = useI18n()

  const isZh = language === 'zh-CN'

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
      <header 
        className="border-b px-6 py-4 flex items-center gap-4"
        style={{ 
          backgroundColor: 'var(--color-bg-secondary)',
          borderColor: 'var(--color-border-primary)'
        }}
      >
        <button
          onClick={() => navigate(-1)}
          className="p-2 rounded-lg transition-colors"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          {t('tosAndPrivacy')}
        </h1>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-8">
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div 
                className="p-2 rounded-lg"
                style={{ backgroundColor: 'var(--color-accent-muted)' }}
              >
                <FileText className="w-5 h-5" style={{ color: 'var(--color-accent-primary)' }} />
              </div>
              <h2 className="text-xl font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                {isZh ? '服务条款' : 'Terms of Service'}
              </h2>
            </div>
            <div 
              className="rounded-xl p-6 space-y-4"
              style={{ 
                backgroundColor: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border-primary)'
              }}
            >
              <div>
                <h3 className="font-medium mb-2" style={{ color: 'var(--color-text-primary)' }}>
                  {isZh ? '1. 服务说明' : '1. Service Description'}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                  {isZh 
                    ? '本服务为自托管电子邮件系统，仅供个人使用。服务可用性不保证，可能随时中断或终止，恕不另行通知。'
                    : 'This service is a self-hosted email system for personal use only. Service availability is not guaranteed and may be interrupted or terminated at any time without notice.'}
                </p>
              </div>
              <div>
                <h3 className="font-medium mb-2" style={{ color: 'var(--color-text-primary)' }}>
                  {isZh ? '2. 使用限制' : '2. Usage Restrictions'}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                  {isZh
                    ? '禁止使用本服务发送垃圾邮件、恶意软件或进行任何违法活动。用户对其账户下的所有活动负责。'
                    : 'You may not use this service to send spam, malware, or engage in any illegal activities. You are responsible for all activities under your account.'}
                </p>
              </div>
              <div>
                <h3 className="font-medium mb-2" style={{ color: 'var(--color-text-primary)' }}>
                  {isZh ? '3. 免责声明' : '3. Disclaimer'}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                  {isZh
                    ? '本服务按"现状"提供，不提供任何明示或暗示的保证。对于因使用本服务而产生的任何直接或间接损失，服务提供者不承担责任。'
                    : 'This service is provided "as is" without any express or implied warranties. The service provider is not liable for any direct or indirect damages arising from the use of this service.'}
                </p>
              </div>
            </div>
          </section>

          <section>
            <div className="flex items-center gap-3 mb-4">
              <div 
                className="p-2 rounded-lg"
                style={{ backgroundColor: 'var(--color-accent-muted)' }}
              >
                <Shield className="w-5 h-5" style={{ color: 'var(--color-accent-primary)' }} />
              </div>
              <h2 className="text-xl font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                {isZh ? '隐私政策' : 'Privacy Policy'}
              </h2>
            </div>
            <div 
              className="rounded-xl p-6 space-y-4"
              style={{ 
                backgroundColor: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border-primary)'
              }}
            >
              <div>
                <h3 className="font-medium mb-2" style={{ color: 'var(--color-text-primary)' }}>
                  {isZh ? '1. 数据收集' : '1. Data Collection'}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                  {isZh
                    ? '我们仅收集提供服务所需的基本信息，包括用户名、密码（加密存储）和电子邮件数据。不会与第三方共享您的数据。'
                    : 'We only collect basic information necessary to provide the service, including username, password (encrypted), and email data. Your data will not be shared with third parties.'}
                </p>
              </div>
              <div>
                <h3 className="font-medium mb-2" style={{ color: 'var(--color-text-primary)' }}>
                  {isZh ? '2. 数据安全' : '2. Data Security'}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                  {isZh
                    ? '所有数据存储在自托管服务器上，采用行业标准加密措施。但请注意，没有任何互联网服务是完全安全的。'
                    : 'All data is stored on self-hosted servers with industry-standard encryption. However, please note that no internet service is completely secure.'}
                </p>
              </div>
              <div>
                <h3 className="font-medium mb-2" style={{ color: 'var(--color-text-primary)' }}>
                  {isZh ? '3. 数据保留' : '3. Data Retention'}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                  {isZh
                    ? '您的数据将保留至您删除账户或服务终止。您可以随时请求删除您的所有数据。'
                    : 'Your data will be retained until you delete your account or the service is terminated. You can request deletion of all your data at any time.'}
                </p>
              </div>
            </div>
          </section>

          <section>
            <div className="flex items-center gap-3 mb-4">
              <div 
                className="p-2 rounded-lg"
                style={{ backgroundColor: 'rgba(251, 191, 36, 0.15)' }}
              >
                <AlertCircle className="w-5 h-5" style={{ color: '#fbbf24' }} />
              </div>
              <h2 className="text-xl font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                {isZh ? '重要提示' : 'Important Notice'}
              </h2>
            </div>
            <div 
              className="rounded-xl p-6"
              style={{ 
                backgroundColor: 'rgba(251, 191, 36, 0.1)',
                border: '1px solid rgba(251, 191, 36, 0.2)'
              }}
            >
              <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                {isZh
                  ? '本服务为个人项目，不提供任何商业保证。服务可能随时变更、暂停或终止。使用本服务即表示您同意上述条款。如有疑问，请联系管理员。'
                  : 'This service is a personal project and does not provide any commercial guarantees. The service may be changed, suspended, or terminated at any time. By using this service, you agree to the above terms. If you have any questions, please contact the administrator.'}
              </p>
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
