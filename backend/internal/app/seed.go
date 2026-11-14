package app

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// seedCatalog installs original sample sentences once, so later admin deletions stay deleted.
func seedCatalog(ctx context.Context, tx *sql.Tx) error {
	var seeded int
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM metadata WHERE key='curated_seed_v1'").Scan(&seeded); err != nil {
		return err
	}
	if seeded != 0 {
		return nil
	}
	for _, seed := range curatedBooks {
		result, err := tx.ExecContext(ctx, "INSERT INTO books(title,subtitle,description,category,color) VALUES(?,?,?,?,?)", seed.title, seed.subtitle, "20 个精选样本词，配原创双语例句，帮助体验学习与复习流程；不代表考试完整词表或完整覆盖。", seed.category, seed.color)
		if err != nil {
			return err
		}
		id, err := result.LastInsertId()
		if err != nil {
			return err
		}
		lines := strings.Split(strings.TrimSpace(seed.words), "\n")
		if len(lines) < 20 {
			return fmt.Errorf("%s needs at least 20 samples", seed.title)
		}
		for _, line := range lines {
			fields := strings.Split(line, "|")
			if len(fields) != 5 {
				return fmt.Errorf("invalid seed in %s", seed.title)
			}
			if _, err = tx.ExecContext(ctx, "INSERT INTO words(book_id,text,phonetic,meaning,example,example_meaning) VALUES(?,?,?,?,?,?)", id, fields[0], fields[1], fields[2], fields[3], fields[4]); err != nil {
				return err
			}
		}
	}
	if _, err := tx.ExecContext(ctx, "UPDATE users SET active_book_id=(SELECT MIN(id) FROM books) WHERE active_book_id IS NULL"); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, "INSERT INTO metadata(key,value) VALUES('curated_seed_v1','1')")
	return err
}

var curatedBooks = []struct{ title, subtitle, category, color, words string }{
	{"CET4 四级精选", "校园与日常表达 · 20 词样本", "CET4", "#7058d9", `
achieve|/əˈtʃiːv/|v. 实现；达到|Mina hopes to achieve her reading goal before Friday.|米娜希望在周五之前完成阅读目标。
adapt|/əˈdæpt/|v. 适应；改编|We adapt our study plan when the library closes early.|图书馆提前关门时，我们会调整学习计划。
afford|/əˈfɔːd/|v. 买得起；承担得起|I can afford a used bicycle after saving for two months.|攒了两个月的钱后，我买得起一辆二手自行车了。
benefit|/ˈbenɪfɪt/|n. 益处；v. 使受益|One benefit of walking to class is a calmer morning.|步行去上课的一个好处是早晨更加从容。
compare|/kəmˈpeə/|v. 比较|Compare the two timetables before choosing a course.|选课前比较一下这两张课表。
confident|/ˈkɒnfɪdənt/|adj. 自信的|Lin feels confident after explaining the problem aloud.|大声讲解了这道题后，林感到很有信心。
consider|/kənˈsɪdə/|v. 考虑；认为|Please consider the travel time as well as the ticket price.|请在考虑票价的同时也考虑旅途时间。
develop|/dɪˈveləp/|v. 发展；培养|Our class will develop a small garden behind the lab.|我们班将在实验室后面开辟一片小花园。
efficient|/ɪˈfɪʃənt/|adj. 高效的|Sorting notes by topic makes revision more efficient.|按主题整理笔记能让复习更高效。
encourage|/ɪnˈkʌrɪdʒ/|v. 鼓励|The coach uses short messages to encourage new runners.|教练用简短的留言鼓励新跑者。
environment|/ɪnˈvaɪrənmənt/|n. 环境|A quiet environment helps me notice small mistakes.|安静的环境有助于我发现细小的错误。
essential|/ɪˈsenʃəl/|adj. 必不可少的|Fresh water is essential for our weekend hike.|干净的饮用水是周末徒步必不可少的物品。
improve|/ɪmˈpruːv/|v. 改进；提高|Recording one sentence daily can improve your pronunciation.|每天录一句话可以改善你的发音。
include|/ɪnˈkluːd/|v. 包括|The club fee will include a simple lunch on Saturday.|社团费用将包含周六的一份简餐。
manage|/ˈmænɪdʒ/|v. 管理；设法做到|We manage our shared expenses with a paper notebook.|我们用一本纸质笔记本管理共同开支。
opportunity|/ˌɒpəˈtjuːnəti/|n. 机会|The campus fair offers an opportunity to meet local artists.|校园集市提供了结识本地艺术家的机会。
prepare|/prɪˈpeə/|v. 准备|I prepare tomorrow's bag before turning off the light.|我在关灯前收拾好明天要用的书包。
reduce|/rɪˈdjuːs/|v. 减少|Sharing printed handouts can reduce paper waste.|共用打印讲义可以减少纸张浪费。
require|/rɪˈkwaɪə/|v. 需要；要求|Some experiments require patience more than expensive tools.|有些实验更需要耐心，而非昂贵的工具。
responsible|/rɪˈspɒnsəbəl/|adj. 负责的；有责任的|Jia is responsible for returning the borrowed projector.|佳负责归还借来的投影仪。
`},
	{"CET6 六级精选", "论证与社会议题 · 20 词样本", "CET6", "#347a87", `
acknowledge|/əkˈnɒlɪdʒ/|v. 承认；致谢|The report will acknowledge the limits of the small survey.|报告将承认这项小规模调查的局限性。
advocate|/ˈædvəkeɪt/|v. 提倡；主张|Residents advocate safer crossings near the evening market.|居民主张在夜市附近设置更安全的人行横道。
allocate|/ˈæləkeɪt/|v. 分配|The committee will allocate extra time to student questions.|委员会将分配额外时间供学生提问。
ambiguous|/æmˈbɪɡjuəs/|adj. 模棱两可的|An ambiguous label caused two teams to use different files.|一个含义不清的标签导致两个团队使用了不同的文件。
assumption|/əˈsʌmpʃən/|n. 假设|Our budget rests on the assumption that rent stays stable.|我们的预算基于租金保持稳定这一假设。
coherent|/kəʊˈhɪərənt/|adj. 连贯的；一致的|She turned scattered interview notes into a coherent account.|她把零散的访谈笔记整理成了一篇连贯的叙述。
compensate|/ˈkɒmpenseɪt/|v. 补偿；弥补|A wider window can compensate for the room's narrow shape.|更宽的窗户可以弥补房间狭长的不足。
comprehensive|/ˌkɒmprɪˈhensɪv/|adj. 全面的|The guide gives a comprehensive view of local transport options.|这份指南全面介绍了当地的交通选择。
constrain|/kənˈstreɪn/|v. 限制；约束|Limited storage may constrain the size of our archive.|有限的存储空间可能会限制我们档案的规模。
controversy|/ˈkɒntrəvɜːsi/|n. 争议|The proposed parking fee sparked controversy among shop owners.|拟议中的停车收费在店主中引发了争议。
derive|/dɪˈraɪv/|v. 获得；源自|We derive the estimate from three months of actual readings.|我们根据三个月的实际读数得出这一估算。
diminish|/dɪˈmɪnɪʃ/|v. 减少；削弱|Clear instructions diminish the need for repeated explanations.|清晰的说明减少了反复解释的必要。
enhance|/ɪnˈhɑːns/|v. 提高；增强|A shaded courtyard can enhance comfort during summer breaks.|有遮阴的庭院能提升夏季休息时的舒适度。
feasible|/ˈfiːzəbəl/|adj. 可行的|A weekend trial will show whether the delivery plan is feasible.|一次周末试运行将表明配送计划是否可行。
incentive|/ɪnˈsentɪv/|n. 激励；诱因|Free repairs give cyclists an incentive to maintain old bikes.|免费维修鼓励骑行者保养旧自行车。
inevitable|/ɪnˈevɪtəbəl/|adj. 不可避免的|Some delay is inevitable when the only bridge is repaired.|唯一的桥梁维修时，一些延误不可避免。
perspective|/pəˈspektɪv/|n. 视角；观点|A night shift offered me a different perspective on the station.|一次夜班让我从不同角度认识了这个车站。
reluctant|/rɪˈlʌktənt/|adj. 不情愿的|The team was reluctant to discard a promising early sketch.|团队不愿丢弃一张有潜力的早期草图。
substantial|/səbˈstænʃəl/|adj. 大量的；实质性的|Insulating the roof brought substantial savings in winter heating.|屋顶保温大幅节省了冬季取暖费用。
sustain|/səˈsteɪn/|v. 维持；支撑|Weekly practice helps sustain the skills learned in the workshop.|每周练习有助于保持在工作坊中学到的技能。
`},
	{"考研英语精选", "阅读推理与学术表达 · 20 词样本", "考研", "#bc7551", `
abstract|/ˈæbstrækt/|adj. 抽象的；n. 摘要|A concrete example made the abstract argument easier to follow.|一个具体例子让抽象论证更容易理解。
arbitrary|/ˈɑːbɪtrəri/|adj. 任意的；武断的|The reviewer questioned the arbitrary choice of a five-year limit.|审稿人质疑了随意设定五年期限的做法。
bias|/ˈbaɪəs/|n. 偏见；偏差|Recruiting only volunteers may introduce bias into the survey.|只招募志愿者可能使调查产生偏差。
constitute|/ˈkɒnstɪtjuːt/|v. 构成|Small independent stores constitute half of the street's businesses.|独立小店构成了这条街上一半的商户。
convention|/kənˈvenʃən/|n. 惯例；大会|By convention, each chapter begins with a brief question.|按照惯例，每章都以一个简短的问题开头。
criterion|/kraɪˈtɪəriən/|n. 标准；准则|Accuracy is the main criterion for selecting the final model.|准确性是选择最终模型的主要标准。
empirical|/ɪmˈpɪrɪkəl/|adj. 实证的；以经验为依据的|The author seeks empirical evidence in the town's rental records.|作者在镇上的租赁记录中寻找实证证据。
explicit|/ɪkˈsplɪsɪt/|adj. 明确的|The agreement gives explicit permission to reuse the drawings.|协议明确允许再次使用这些图纸。
hypothesis|/haɪˈpɒθəsɪs/|n. 假说；假设|Their hypothesis predicts shorter queues after the schedule changes.|他们的假说预测，调整时刻表后排队会变短。
imply|/ɪmˈplaɪ/|v. 意味着；暗示|A higher price does not necessarily imply better durability.|更高的价格并不一定意味着更好的耐用性。
infer|/ɪnˈfɜː/|v. 推断|Readers can infer the speaker's concern from her repeated pauses.|读者可以从说话者反复停顿中推断出她的担忧。
integrate|/ˈɪntɪɡreɪt/|v. 整合；融入|The course will integrate field observations with weekly discussions.|这门课程将把实地观察与每周讨论结合起来。
interpret|/ɪnˈtɜːprɪt/|v. 解释；解读|Different readers may interpret the final paragraph differently.|不同读者可能对最后一段有不同解读。
justify|/ˈdʒʌstɪfaɪ/|v. 证明合理|The available data cannot justify such a precise forecast.|现有数据不足以支持如此精确的预测。
notion|/ˈnəʊʃən/|n. 观念；想法|The experiment challenges the notion that speed always improves work.|这项实验挑战了速度总能改善工作这一观念。
paradox|/ˈpærədɒks/|n. 悖论；矛盾现象|The essay explores the paradox of feeling isolated in a busy city.|文章探讨了在繁忙城市里感到孤独这一矛盾现象。
precede|/prɪˈsiːd/|v. 先于；在前面|A careful definition should precede any comparison of the results.|在比较结果之前，应先给出严谨的定义。
relevant|/ˈreləvənt/|adj. 相关的|Only evidence relevant to the original question belongs here.|此处只应包含与最初问题有关的证据。
underlying|/ˌʌndəˈlaɪɪŋ/|adj. 潜在的；根本的|The interviews revealed an underlying concern about job security.|访谈揭示了对工作保障的深层担忧。
valid|/ˈvælɪd/|adj. 有效的；有根据的|The conclusion remains valid only within the tested temperature range.|这一结论仅在测试过的温度范围内有效。
`},
	{"IELTS 雅思精选", "城市生活与环境话题 · 20 词样本", "IELTS", "#409173", `
accommodation|/əˌkɒməˈdeɪʃən/|n. 住宿|Our accommodation is a small flat above a quiet bakery.|我们的住处是安静面包店楼上的一套小公寓。
amenity|/əˈmiːnəti/|n. 便利设施|The riverside reading room is my favourite local amenity.|河边的阅览室是我最喜欢的本地公共设施。
biodiversity|/ˌbaɪəʊdaɪˈvɜːsəti/|n. 生物多样性|Planting native flowers can support biodiversity in tiny gardens.|种植本地花卉能促进小花园中的生物多样性。
commute|/kəˈmjuːt/|v. 通勤；n. 通勤路程|I commute by ferry twice a week and read on the way.|我每周乘渡轮通勤两次，并在路上阅读。
conservation|/ˌkɒnsəˈveɪʃən/|n. 保护；节约|The museum runs a conservation project for old wooden boats.|博物馆开展了一个保护旧木船的项目。
consumption|/kənˈsʌmpʃən/|n. 消耗；消费|The chart tracks household water consumption during a dry summer.|图表记录了一个干旱夏季的家庭用水量。
cuisine|/kwɪˈziːn/|n. 烹饪；菜肴风味|Local cuisine reflects the vegetables grown on nearby hills.|当地菜肴体现了附近山坡上种植的蔬菜特色。
density|/ˈdensəti/|n. 密度|Tree density is highest along the park's northern edge.|公园北侧边缘的树木密度最高。
emission|/ɪˈmɪʃən/|n. 排放|The new heating system produces less carbon emission per room.|新的供暖系统使每个房间的碳排放减少。
fluctuate|/ˈflʌktʃueɪt/|v. 波动|Visitor numbers fluctuate sharply when the weather changes.|天气变化时，游客数量会大幅波动。
heritage|/ˈherɪtɪdʒ/|n. 遗产；传统|Restoring the old theatre helped preserve the district's heritage.|修复老剧院有助于保护这个街区的历史遗产。
infrastructure|/ˈɪnfrəstrʌktʃə/|n. 基础设施|Reliable cycling infrastructure makes short trips more convenient.|可靠的自行车基础设施使短途出行更加方便。
landscape|/ˈlændskeɪp/|n. 景观；风景|Winter fog gives the coastal landscape a softer outline.|冬日雾气让沿海景观的轮廓更加柔和。
leisure|/ˈleʒə/|n. 闲暇；休闲|I spend most of my leisure time sketching birds in the park.|我把大部分闲暇时间用来在公园里画鸟。
pedestrian|/pəˈdestriən/|n. 行人；adj. 步行的|A new pedestrian bridge connects the station to the market.|一座新的人行桥连接了车站和市场。
renewable|/rɪˈnjuːəbəl/|adj. 可再生的|The island school uses renewable energy from wind and sunlight.|岛上的学校利用来自风和阳光的可再生能源。
resident|/ˈrezɪdənt/|n. 居民|Each resident can borrow gardening tools from the community centre.|每位居民都可以从社区中心借用园艺工具。
sustainable|/səˈsteɪnəbəl/|adj. 可持续的|Repairing furniture is one practical step toward sustainable living.|修理家具是迈向可持续生活的一个实际步骤。
urban|/ˈɜːbən/|adj. 城市的|Urban gardens give children a place to observe seasonal changes.|城市花园为孩子们提供了观察季节变化的场所。
venue|/ˈvenjuː/|n. 场所；举办地点|The old station became a venue for weekend music events.|老车站成了周末音乐活动的举办场所。
`},
	{"TOEFL 托福精选", "自然科学与校园学术 · 20 词样本", "TOEFL", "#4b7db5", `
adaptation|/ˌædæpˈteɪʃən/|n. 适应；适应性变化|The insect's pale colour is an adaptation to sandy ground.|这种昆虫的浅色是对沙土地面的适应。
archaeology|/ˌɑːkiˈɒlədʒi/|n. 考古学|Her interest in archaeology began with a broken clay lamp.|她对考古学的兴趣始于一盏破损的陶灯。
atmosphere|/ˈætməsfɪə/|n. 大气；气氛|Tiny particles in the atmosphere can change the colour of sunsets.|大气中的微小颗粒能改变日落的颜色。
classify|/ˈklæsɪfaɪ/|v. 分类|Students classify the collected leaves by shape and texture.|学生按照形状和质地对采集的叶片进行分类。
deposit|/dɪˈpɒzɪt/|n. 沉积物；v. 沉积|The stream leaves a fine deposit of sand after heavy rain.|大雨过后，小溪留下一层细沙沉积物。
ecosystem|/ˈiːkəʊsɪstəm/|n. 生态系统|Even a shallow pond supports a complex ecosystem.|即使一个浅池塘也能支撑复杂的生态系统。
erosion|/ɪˈrəʊʒən/|n. 侵蚀|Grass roots slow erosion on the newly planted slope.|草根减缓了新种植坡面上的侵蚀。
evolution|/ˌiːvəˈluːʃən/|n. 进化；演变|The lecture linked shell shapes to the evolution of sea snails.|这场讲座把贝壳形状与海螺的进化联系起来。
excavate|/ˈekskəveɪt/|v. 挖掘；发掘|Researchers will excavate a narrow strip beside the ancient wall.|研究人员将在古墙旁发掘一条狭长地带。
fossil|/ˈfɒsəl/|n. 化石|A leaf fossil helped date the layer beneath the road.|一块叶片化石帮助确定了道路下方地层的年代。
habitat|/ˈhæbɪtæt/|n. 栖息地|The flooded meadow becomes a temporary habitat for migrating birds.|被水淹没的草地成为候鸟的临时栖息地。
migration|/maɪˈɡreɪʃən/|n. 迁徙；迁移|The students mapped bird migration using observations from three towns.|学生利用三个城镇的观察记录绘制了鸟类迁徙图。
nutrient|/ˈnjuːtriənt/|n. 营养物；养分|The experiment measured nutrient levels in rainwater and soil.|实验测量了雨水和土壤中的养分含量。
organism|/ˈɔːɡənɪzəm/|n. 生物；有机体|This tiny organism survives in water that freezes each winter.|这种微小生物生活在每年冬天都会结冰的水中。
photosynthesis|/ˌfəʊtəʊˈsɪnθəsɪs/|n. 光合作用|A classroom lamp lets us compare photosynthesis under different colours of light.|教室里的一盏灯让我们能够比较不同颜色光照下的光合作用。
precipitation|/prɪˌsɪpɪˈteɪʃən/|n. 降水；沉淀|Annual precipitation is lower on the mountain's eastern side.|山脉东侧的年降水量较低。
sediment|/ˈsedɪmənt/|n. 沉积物|Dark sediment at the lake bottom records an ancient forest fire.|湖底的深色沉积物记录了一场古老的森林火灾。
specimen|/ˈspesɪmɪn/|n. 标本；样本|The museum stores each fragile specimen in a padded drawer.|博物馆把每件脆弱标本存放在有软垫的抽屉里。
tectonic|/tekˈtɒnɪk/|adj. 地壳构造的|Tectonic movement slowly raised the rocks now visible on the cliff.|地壳构造运动缓慢抬升了如今在悬崖上可见的岩石。
volcanic|/vɒlˈkænɪk/|adj. 火山的|The island's dark beaches contain grains of volcanic rock.|岛上的深色沙滩含有火山岩颗粒。
`},
	{"日常英语精选", "生活场景与轻松交流 · 20 词样本", "日常", "#c28a42", `
appointment|/əˈpɔɪntmənt/|n. 预约；约会|My dental appointment is just after lunch on Tuesday.|我的牙科预约在周二午饭之后。
borrow|/ˈbɒrəʊ/|v. 借入|Could I borrow your umbrella until the rain stops?|雨停之前，我可以借用你的伞吗？
cancel|/ˈkænsəl/|v. 取消|We may cancel the picnic if the riverside path floods.|如果河边小路被淹，我们可能会取消野餐。
change|/tʃeɪndʒ/|n. 零钱；变化；v. 改变|The driver gave me the correct change for my ticket.|司机找给了我买票应得的零钱。
comfortable|/ˈkʌmftəbəl/|adj. 舒适的|These shoes stay comfortable even after a long walk.|即使走了很长的路，这双鞋仍然很舒服。
delivery|/dɪˈlɪvəri/|n. 配送；交付|The shop offers evening delivery for people who work late.|这家商店为下班晚的人提供晚间配送。
direction|/dəˈrekʃən/|n. 方向；指引|The blue sign points in the direction of the bus stop.|蓝色标牌指向公交站的方向。
grocery|/ˈɡrəʊsəri/|n. 食品杂货；杂货店|I keep a grocery list on the fridge door.|我把一张食品杂货清单贴在冰箱门上。
ingredient|/ɪnˈɡriːdiənt/|n. 配料；成分|Lemon juice is the last ingredient in this simple sauce.|柠檬汁是这款简易酱汁的最后一种配料。
laundry|/ˈlɔːndri/|n. 待洗衣物；洗衣|We hang the laundry indoors when sea fog arrives.|海雾来临时，我们把洗好的衣物晾在室内。
neighbour|/ˈneɪbə/|n. 邻居|Our neighbour waters the balcony plants while we are away.|我们外出时，邻居帮忙给阳台上的植物浇水。
receipt|/rɪˈsiːt/|n. 收据|Keep the receipt in case the kettle needs to be returned.|保留收据，以防需要退还这个水壶。
recommend|/ˌrekəˈmend/|v. 推荐|Can you recommend a quiet cafe near the station?|你能推荐一家车站附近安静的咖啡馆吗？
refund|/ˈriːfʌnd/|n. 退款|The shop issued a refund for the damaged cup.|商店为损坏的杯子办理了退款。
remind|/rɪˈmaɪnd/|v. 提醒|Please remind me to bring the library books tomorrow.|请提醒我明天带上图书馆的书。
repair|/rɪˈpeə/|v. 修理；n. 维修|A small local shop can repair the broken zipper.|一家本地小店可以修好这个坏拉链。
reservation|/ˌrezəˈveɪʃən/|n. 预订|Our dinner reservation is for a table beside the window.|我们晚餐预订的是一张靠窗的桌子。
schedule|/ˈʃedjuːl/|n. 时间表；v. 安排|I check the weekend bus schedule before leaving home.|我出门前会查看周末公交时刻表。
spare|/speə/|adj. 备用的；空闲的|There is a spare key inside the green envelope.|绿色信封里有一把备用钥匙。
tidy|/ˈtaɪdi/|adj. 整洁的；v. 整理|We tidy the kitchen together after making dumplings.|包完饺子后，我们一起收拾厨房。
`},
}
